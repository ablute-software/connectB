// Prompt 905 — a stateful in-memory stand-in for the slice of supabase-js the Calls code uses, so the route tests
// run the REAL routes, access rules and store over data that actually changes. It models what the database
// enforces and the code relies on: defaults, the CHECKs of migration 20261009150000 that matter here (non-blank
// names, ordered dates, one promoter), unique link tokens, and the append-only tables.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export interface CallsDb {
  tables: Record<string, Row[]>;
  users: Map<string, { id: string; email: string }>;
  clock: number;
  seq: number;
}

export function callsDb(): CallsDb {
  const names = [
    'calls', 'call_phases', 'call_form_fields', 'call_config_snapshots', 'call_applications', 'call_application_submissions', 'call_events',
    'catalog_entities', 'incubators', 'matchdeal_investor_members', 'incubator_members', 'investor_billing',
  ];
  return { tables: Object.fromEntries(names.map((n) => [n, []])), users: new Map(), clock: Date.UTC(2026, 9, 9, 12, 0, 0), seq: 0 };
}

const tick = (db: CallsDb) => new Date((db.clock += 1000)).toISOString();
const uuid = (db: CallsDb) => `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`;

class Violation extends Error { code: string; constructor(m: string, code = '23514') { super(m); this.code = code; } }

const DEFAULTS: Record<string, (db: CallsDb) => Row> = {
  calls: () => ({
    description: null, opens_at: null, closes_at: null, timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project',
    allow_multiple: false, content_language: 'en', currency: 'EUR', status: 'draft', link_token: null, config_version: 1,
    validated_at: null, validated_by: null, published_at: null, closed_at: null, duplicated_from: null, catalog_entity_id: null, incubator_id: null,
  }),
  call_phases: () => ({ starts_on: null, ends_on: null }),
  call_form_fields: () => ({
    page: 1, position: 0, instruction: null, required: false, options: [], validations: {}, condition: null,
    platform_mapping: null, expected_type: null, max_age_months: null,
  }),
  call_applications: () => ({ status: 'draft', draft_answers: {}, startup_org_id: null, current_submission_id: null }),
  call_events: () => ({ application_id: null, actor_user_id: null, detail: {} }),
};

function check(table: string, row: Row, all: Row[]) {
  if (table === 'calls') {
    if (typeof row.name !== 'string' || row.name.trim() === '') throw new Violation('calls_name_check');
    const kindOk = (row.promoter_kind === 'catalog_entity' && row.catalog_entity_id && !row.incubator_id)
      || (row.promoter_kind === 'incubator' && row.incubator_id && !row.catalog_entity_id);
    if (!kindOk) throw new Violation('calls_one_promoter');
    if (row.opens_at && row.closes_at && Date.parse(row.closes_at as string) <= Date.parse(row.opens_at as string)) throw new Violation('calls_dates_ordered');
    if (row.link_token && all.some((r) => r !== row && r.link_token === row.link_token)) throw new Violation('calls_link_token_key', '23505');
  }
  if (table === 'call_form_fields' && (typeof row.label !== 'string' || row.label.trim() === '')) throw new Violation('call_form_fields_label_check');
  if (table === 'call_phases' && (typeof row.name !== 'string' || row.name.trim() === '')) throw new Violation('call_phases_name_check');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(db: CallsDb, table: string): any {
  const preds: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  let values: Row | Row[] = {};
  let onConflict = '';
  const sorts: { col: string; asc: boolean }[] = [];
  let max = Infinity;

  const exec = (): { data: Row[]; error: { code?: string; message: string } | null } => {
    try {
      const rows = db.tables[table];
      if (!rows) return { data: [], error: { message: `relation "${table}" does not exist`, code: '42P01' } };
      if (op === 'insert' || op === 'upsert') {
        const out: Row[] = [];
        for (const v of Array.isArray(values) ? values : [values]) {
          const existing = op === 'upsert' ? rows.find((r) => r[onConflict || 'id'] === v[onConflict || 'id']) : undefined;
          if (existing) { const next = { ...existing, ...v }; check(table, next, rows.filter((r) => r !== existing)); Object.assign(existing, v); out.push(existing); continue; }
          const row: Row = { ...(DEFAULTS[table]?.(db) ?? {}), ...v };
          if (row.id === undefined && table !== 'call_events') row.id = uuid(db);
          if (table === 'call_events' && row.id === undefined) row.id = ++db.seq;
          if (row.created_at === undefined) row.created_at = tick(db);
          if (table === 'calls' && row.updated_at === undefined) row.updated_at = row.created_at;
          check(table, row, rows);
          rows.push(row); out.push(row);
        }
        return { data: out, error: null };
      }
      let matched = rows.filter((r) => preds.every((p) => p(r)));
      if (op === 'update') {
        if (table === 'call_events' || table === 'call_config_snapshots' || table === 'call_application_submissions') throw new Violation(`${table} is append-only`);
        const done = matched.map((r) => { const next = { ...r, ...(values as Row) }; check(table, next, rows.filter((o) => o !== r)); Object.assign(r, values as Row); return r; });
        return { data: done, error: null };
      }
      if (op === 'delete') {
        if (table === 'call_application_submissions') throw new Violation(`${table} is append-only`);
        for (const r of matched) rows.splice(rows.indexOf(r), 1);
        return { data: matched, error: null };
      }
      for (const s of [...sorts].reverse()) {
        matched = [...matched].sort((a, b) => (s.asc ? 1 : -1) * (typeof a[s.col] === 'number' && typeof b[s.col] === 'number'
          ? (a[s.col] as number) - (b[s.col] as number) : String(a[s.col] ?? '').localeCompare(String(b[s.col] ?? ''))));
      }
      return { data: matched.slice(0, max), error: null };
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
    in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { sorts.push({ col: c, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { max = n; return b; },
    insert: (v: Row | Row[]) => { op = 'insert'; values = v; return b; },
    upsert: (v: Row | Row[], o?: { onConflict?: string }) => { op = 'upsert'; values = v; onConflict = o?.onConflict ?? 'id'; return b; },
    update: (v: Row) => { op = 'update'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    maybeSingle: async () => { const r = exec(); return { data: r.data[0] ?? null, error: r.error }; },
    single: async () => { const r = exec(); return { data: r.data[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
  };
  return b;
}

export function fakeCallsAdmin(db: CallsDb): SupabaseClient {
  return { from: (t: string) => builder(db, t), auth: { admin: { getUserById: async (id: string) => ({ data: { user: db.users.get(id) ?? null }, error: null }) } } } as unknown as SupabaseClient;
}
