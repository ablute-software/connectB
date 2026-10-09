// Prompt 904 Part C — a STATEFUL in-memory stand-in for the slice of supabase-js the seat code uses, so
// the end-to-end seat scenarios (C7) run the REAL lib code (store, checkSeatAvailable, claim
// auto-approval, applyClaimApproval, remove/reassign, redeem) over data that actually changes.
// src/test/fake-supabase.ts records writes and applies none; this one applies them.
//
// It also models, in TypeScript, the two things only Postgres does in production: the seat-limit
// TRIGGER (migration 0285 as replaced by 20261009130000) and the redeem_investor_seat_code()
// function. That is a second implementation of the same rules — stated here so nobody mistakes a green
// test for proof about the SQL itself, which only running the migration can give.
import type { SupabaseClient } from '@supabase/supabase-js';
import { MATCHDEAL_TIER_TO_INVESTOR_PLAN, investorSeatLimit } from '@/lib/plans';

export type Row = Record<string, unknown>;
export interface SeatDb {
  tables: Record<string, Row[]>;
  users: Map<string, { id: string; email: string }>;
  clock: number;
  seq: number;
}

export function seatDb(): SeatDb {
  const tables: Record<string, Row[]> = {
    catalog_entities: [], matchdeal_investor_members: [], matchdeal_profiles: [], investor_entity_claims: [],
    investor_firm_seat_plans: [], investor_firm_seat_invites: [], investor_seat_codes: [], investor_seat_events: [],
    investor_billing: [], investor_firm_seat_plan_archive: [], investor_seat_notices: [],
  };
  return { tables, users: new Map(), clock: Date.UTC(2026, 9, 9, 9, 0, 0), seq: 0 };
}

export function addUser(db: SeatDb, id: string, email: string) { db.users.set(id, { id, email }); }

const now = (db: SeatDb) => new Date((db.clock += 1000)).toISOString();
const nextId = (db: SeatDb, prefix: string) => `${prefix}-${++db.seq}`;

class CheckViolation extends Error { code = '23514'; }

function tierLimit(db: SeatDb, entityId: string): number {
  const plan = db.tables.investor_firm_seat_plans.find((p) => p.catalog_entity_id === entityId && p.status === 'active');
  if (plan) return plan.seats as number;
  const members = db.tables.matchdeal_investor_members
    .filter((m) => m.catalog_entity_id === entityId && m.status === 'active')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const m of members) {
    const prof = db.tables.matchdeal_profiles.find((p) => p.membership_id === m.id && p.kind === 'investor');
    if (prof?.plan_tier) return investorSeatLimit(MATCHDEAL_TIER_TO_INVESTOR_PLAN[prof.plan_tier as string] ?? 'pro_scout');
  }
  return investorSeatLimit('pro_scout');
}

/** matchdeal_investor_members triggers: enforce_matchdeal_seat_limit (before) + log_matchdeal_seat_event (after). */
function memberTriggers(db: SeatDb, prev: Row | null, next: Row) {
  const entering = next.status === 'active' && (!prev || prev.status !== 'active');
  if (entering) {
    const already = db.tables.matchdeal_investor_members.some((m) =>
      m.catalog_entity_id === next.catalog_entity_id && m.user_id === next.user_id && m.status === 'active' && m.id !== next.id);
    if (!already) {
      const used = db.tables.matchdeal_investor_members.filter((m) =>
        m.catalog_entity_id === next.catalog_entity_id && m.status === 'active' && m.user_id !== next.user_id && m.id !== next.id).length;
      const limit = tierLimit(db, next.catalog_entity_id as string);
      if (used >= limit) throw new CheckViolation(`Seat limit reached: ${limit} seat(s), ${used} active.`);
    }
  }
  return () => {
    if (entering) db.tables.investor_seat_events.push({ id: ++db.seq, catalog_entity_id: next.catalog_entity_id, member_id: next.id, user_id: next.user_id, event: 'seat_granted', actor_user_id: null, detail: {}, created_at: now(db) });
    else if (prev && prev.status === 'active' && next.status !== 'active') db.tables.investor_seat_events.push({ id: ++db.seq, catalog_entity_id: next.catalog_entity_id, member_id: next.id, user_id: next.user_id, event: 'seat_released', actor_user_id: null, detail: {}, created_at: now(db) });
  };
}

const DEFAULTS: Record<string, () => Row> = {
  matchdeal_investor_members: () => ({ role: 'member', status: 'active' }),
  investor_firm_seat_invites: () => ({ status: 'open', accepted_user_id: null }),
  investor_seat_codes: () => ({ status: 'active', redeemed_by: null, redeemed_at: null }),
  investor_seat_events: () => ({ detail: {}, actor_user_id: null }),
  investor_entity_claims: () => ({ status: 'pending' }),
};

function insertRow(db: SeatDb, table: string, values: Row): { row: Row; after: () => void } {
  const row: Row = { ...(DEFAULTS[table]?.() ?? {}), ...values };
  if (row.id === undefined) row.id = table === 'investor_seat_events' ? ++db.seq : nextId(db, table);
  if (row.created_at === undefined) row.created_at = now(db);
  let after = () => {};
  if (table === 'matchdeal_investor_members') after = memberTriggers(db, null, row);
  db.tables[table].push(row);
  after();
  return { row, after };
}

function updateRow(db: SeatDb, table: string, row: Row, patch: Row): Row {
  const prev = { ...row };
  const next = { ...row, ...patch };
  let after = () => {};
  if (table === 'matchdeal_investor_members') after = memberTriggers(db, prev, next);
  Object.assign(row, patch);
  after();
  return row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(db: SeatDb, table: string): any {
  const preds: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  let values: Row | Row[] = {};
  let onConflict: string[] = [];
  let sort: { col: string; asc: boolean } | null = null;
  let max = Infinity;

  const exec = (): { data: Row[]; error: { code?: string; message: string } | null } => {
    try {
      if (!db.tables[table]) return { data: [], error: { message: `relation "${table}" does not exist`, code: '42P01' } };
      if (op === 'insert') {
        const rows = (Array.isArray(values) ? values : [values]).map((v) => insertRow(db, table, v).row);
        return { data: rows, error: null };
      }
      if (op === 'upsert') {
        const out: Row[] = [];
        for (const v of Array.isArray(values) ? values : [values]) {
          const existing = db.tables[table].find((r) => onConflict.length > 0 && onConflict.every((c) => r[c] === v[c]));
          out.push(existing ? updateRow(db, table, existing, v) : insertRow(db, table, v).row);
        }
        return { data: out, error: null };
      }
      let rows = db.tables[table].filter((r) => preds.every((p) => p(r)));
      if (op === 'update') return { data: rows.map((r) => updateRow(db, table, r, values as Row)), error: null };
      if (op === 'delete') {
        db.tables[table] = db.tables[table].filter((r) => !rows.includes(r));
        return { data: rows, error: null };
      }
      if (sort) rows = [...rows].sort((a, b) => (sort!.asc ? 1 : -1) * String(a[sort!.col] ?? '').localeCompare(String(b[sort!.col] ?? ''), undefined, { numeric: true }));
      return { data: rows.slice(0, max), error: null };
    } catch (e) {
      const err = e as { code?: string; message: string };
      return { data: [], error: { code: err.code, message: err.message } };
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return b; },
    gte: (c: string, v: unknown) => { preds.push((r) => String(r[c] ?? '') >= String(v)); return b; },
    lte: (c: string, v: unknown) => { preds.push((r) => String(r[c] ?? '') <= String(v)); return b; },
    in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { sort = { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { max = n; return b; },
    insert: (v: Row | Row[]) => { op = 'insert'; values = v; return b; },
    upsert: (v: Row | Row[], o?: { onConflict?: string }) => { op = 'upsert'; values = v; onConflict = (o?.onConflict ?? '').split(',').filter(Boolean); return b; },
    update: (v: Row) => { op = 'update'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    maybeSingle: async () => { const r = exec(); return { data: r.data[0] ?? null, error: r.error }; },
    single: async () => { const r = exec(); return { data: r.data[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
  };
  return b;
}

/** end_investor_seat_plan(), modelled: archive with a snapshot of the members + status + history, as one step. */
function endPlan(db: SeatDb, entity: string, actor: string | null) {
  const plan = db.tables.investor_firm_seat_plans.find((p) => p.catalog_entity_id === entity && p.status === 'active');
  if (!plan) return { ok: false };
  const members = db.tables.matchdeal_investor_members.filter((m) => m.catalog_entity_id === entity && m.status === 'active').map((m) => {
    const granted = db.tables.investor_seat_events.filter((e) => e.member_id === m.id && e.event === 'seat_granted').map((e) => e.created_at as string).sort().pop();
    const profile = db.tables.matchdeal_profiles.find((p) => p.membership_id === m.id && p.kind === 'investor');
    return {
      userId: m.user_id, email: db.users.get(m.user_id as string)?.email.toLowerCase() ?? null,
      name: (profile?.representative_name as string | undefined) ?? null, role: m.role, since: granted ?? m.created_at,
    };
  });
  const archiveId = nextId(db, 'archive');
  const endedAt = now(db);
  db.tables.investor_firm_seat_plan_archive.push({
    id: archiveId, catalog_entity_id: entity, plan_name: plan.plan_name, seats: plan.seats, tier: plan.tier, activated_via: plan.activated_via,
    admin_email: plan.admin_email ?? null, note: plan.note ?? null, plan_created_at: plan.created_at ?? endedAt, plan_changed_at: plan.updated_at ?? endedAt,
    ended_at: endedAt, ended_by: actor, members, reconstructed: false,
  });
  Object.assign(plan, { status: 'ended', updated_at: endedAt });
  db.tables.investor_seat_events.push({ id: ++db.seq, catalog_entity_id: entity, member_id: null, user_id: null, event: 'plan_ended', actor_user_id: actor, detail: { seats: plan.seats, archiveId, members: members.length }, created_at: endedAt });
  return { ok: true, archiveId, seats: plan.seats };
}

/** redeem_investor_seat_code(), modelled — see the file header. */
function redeem(db: SeatDb, codeHash: string, userId: string) {
  const c = db.tables.investor_seat_codes.find((r) => r.code_hash === codeHash);
  if (!c || c.status !== 'active' || new Date(c.expires_at as string).getTime() <= db.clock) return { ok: false };
  const entity = c.catalog_entity_id as string;
  const claimed = db.tables.investor_entity_claims.some((cl) => cl.catalog_entity_id === entity && cl.claimant_user_id === userId && cl.status === 'approved');
  const seated = db.tables.matchdeal_investor_members.some((m) => m.catalog_entity_id === entity && m.user_id === userId && m.status === 'active');
  if (!claimed || !seated) return { ok: false };
  const email = db.users.get(userId)?.email.toLowerCase() ?? null;
  const existing = db.tables.investor_firm_seat_plans.find((p) => p.catalog_entity_id === entity);
  if (existing) {
    const live = existing.status === 'active';
    Object.assign(existing, {
      seats: live ? Math.max(existing.seats as number, c.seats as number) : c.seats, tier: c.tier, plan_name: c.plan_name,
      status: 'active', activated_via: 'promo_code', admin_email: live ? (existing.admin_email ?? email) : email,
      ...(live ? {} : { created_at: now(db) }),
    });
  }
  else db.tables.investor_firm_seat_plans.push({ catalog_entity_id: entity, plan_name: c.plan_name, seats: c.seats, tier: c.tier, status: 'active', activated_via: 'promo_code', admin_email: email });
  Object.assign(c, { status: 'redeemed', redeemed_by: userId, redeemed_at: now(db) });
  const hasAdmin = db.tables.matchdeal_investor_members.some((m) => m.catalog_entity_id === entity && m.status === 'active' && ['owner', 'admin'].includes(m.role as string));
  if (!hasAdmin) {
    const mine = db.tables.matchdeal_investor_members.find((m) => m.catalog_entity_id === entity && m.user_id === userId && m.status === 'active');
    if (mine) mine.role = 'admin';
  }
  db.tables.investor_seat_events.push({ id: ++db.seq, catalog_entity_id: entity, user_id: userId, event: 'code_redeemed', actor_user_id: userId, detail: {}, created_at: now(db) });
  return { ok: true, catalog_entity_id: entity, seats: c.seats, tier: c.tier };
}

export function fakeSeatAdmin(db: SeatDb): SupabaseClient {
  return {
    from: (t: string) => builder(db, t),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'redeem_investor_seat_code') return { data: redeem(db, args.p_code_hash as string, args.p_user as string), error: null };
      if (name === 'end_investor_seat_plan') return { data: endPlan(db, args.p_entity as string, (args.p_actor as string | null) ?? null), error: null };
      if (name === 'seat_user_id_by_email') {
        const want = String(args.p_email ?? '').trim().toLowerCase();
        return { data: [...db.users.values()].find((u) => u.email.toLowerCase() === want)?.id ?? null, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: db.users.get(id) ?? null }, error: null }) } },
  } as unknown as SupabaseClient;
}
