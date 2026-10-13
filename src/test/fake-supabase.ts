// Prompt 902 — a tiny in-memory stand-in for the slice of supabase-js the
// founder-side routes use, so a route test can assert on WHICH rows came back
// instead of on which methods were called. The point of the viewer-org tests is
// "caller is a member of org A, viewing org B → only B's data": that needs real
// `.eq('org_id', …)` filtering, not a mock that returns whatever it was given.
//
// Deliberately small: eq / in / is / not / neq / gt / gte / lt / lte / like / ilike /
// contains / match filter for real; select, order, limit, range are accepted and
// ignored (`select(cols, { count, head })` answers a count); `or` is a PostgREST
// filter string — ignored unless `db.evalOr` is set (a test that depends on it
// filtering must say so with its fixture rows and opt in); any other builder method
// is accepted and ignored, so a route that uses an exotic filter still runs.
// update / insert / delete / upsert are recorded in `db.writes` (and applied to
// nothing — a test asserts on the record, never on the resulting table) UNLESS the
// test opts in with `db.applyWrites = true` (Prompt 906): then insert / update /
// delete really change `tables` and answer with the affected rows, which is what a
// create → edit → delete → read-back test needs. upsert stays record-only.
// maybeSingle()/single() return the first match, which is enough for the
// one-membership-per-user fixtures here.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;

export interface Write {
  table: string;
  op: 'update' | 'insert' | 'delete' | 'upsert';
  values: unknown;
  eqs: [string, unknown][];
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  writes: Write[];
  /** Evaluate PostgREST `or('a.eq.1,b.is.null')` strings (default: accepted and ignored). */
  evalOr?: boolean;
  /** Named rpc answers, for both the session and the service client. A function receives the args. */
  rpc?: Record<string, unknown | ((args: unknown) => unknown)>;
  /** auth.admin.getUserById lookups. */
  authUsers?: Record<string, { email: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null; created_at?: string }>;
  /** Every rpc the routes called, in order (name + args) — a viewer test asserts no write rpc ran. */
  rpcCalls?: { name: string; args: unknown }[];
  /** Opt in: insert / update / delete change `tables` (default: they are only recorded in `writes`). */
  applyWrites?: boolean;
  /** Models a database trigger: called with the row as it is after an applied update, and as it was before. */
  afterUpdate?: Record<string, (after: Row, before: Row) => void>;
}

export function fakeDb(tables: Record<string, Row[]>): FakeDb {
  return { tables, writes: [], rpcCalls: [] };
}

// `detail->>route` reads a key out of a jsonb column, the way PostgREST filters do.
function cell(r: Row, col: string): unknown {
  const i = col.indexOf('->>');
  if (i < 0) return r[col];
  const inner = r[col.slice(0, i)];
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>)[col.slice(i + 3)] : undefined;
}

function likeToRegExp(pattern: string, flags: string): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + esc + '$', flags);
}

// One `col.op.value` condition of an or(...) string. Unknown operators are TRUE (never hide a row by accident).
function orCondition(r: Row, cond: string): boolean {
  const m = cond.match(/^([^.]+)\.(not\.)?([a-z]+)\.(.*)$/);
  if (!m) return true;
  const [, col, negated, op, raw] = m;
  const v = cell(r, col);
  let hit: boolean;
  switch (op) {
    case 'eq': hit = String(v) === raw; break;
    case 'neq': hit = String(v) !== raw; break;
    case 'is': hit = raw === 'null' ? v == null : raw === 'true' ? v === true : raw === 'false' ? v === false : true; break;
    case 'in': hit = raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v)); break;
    case 'gt': hit = (v as number | string) > raw; break;
    case 'gte': hit = (v as number | string) >= raw; break;
    case 'lt': hit = (v as number | string) < raw; break;
    case 'lte': hit = (v as number | string) <= raw; break;
    case 'like': hit = likeToRegExp(raw, '').test(String(v ?? '')); break;
    case 'ilike': hit = likeToRegExp(raw, 'i').test(String(v ?? '')); break;
    default: return true;
  }
  return negated ? !hit : hit;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(db: FakeDb, table: string): any {
  const predicates: ((r: Row) => boolean)[] = [];
  const eqs: [string, unknown][] = [];
  let op: Write['op'] | null = null;
  let values: unknown;
  let selectOpts: { count?: string; head?: boolean } = {};

  const run = (): Row[] => {
    const rows = (db.tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
    if (op) db.writes.push({ table, op, values, eqs: [...eqs] });
    if (!db.applyWrites || !op) return rows;
    if (op === 'insert') {
      const created = ((Array.isArray(values) ? values : [values]) as Row[])
        .map((v) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...v }));
      (db.tables[table] ??= []).push(...created);
      return created;
    }
    if (op === 'update') {
      for (const r of rows) {
        const before = { ...r };
        Object.assign(r, values as Row);
        db.afterUpdate?.[table]?.(r, before);
      }
      return rows;
    }
    if (op === 'delete') {
      db.tables[table] = (db.tables[table] ?? []).filter((r) => !rows.includes(r));
      return rows;
    }
    return rows;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => { if (opts) selectOpts = opts; return b; },
    order: () => b,
    limit: () => b,
    range: () => b,
    or: (filter: string) => {
      if (db.evalOr) {
        const conds = splitTopLevel(filter);
        predicates.push((r) => conds.some((c) => orCondition(r, c)));
      }
      return b;
    },
    eq: (col: string, val: unknown) => { eqs.push([col, val]); predicates.push((r) => cell(r, col) === val); return b; },
    neq: (col: string, val: unknown) => { predicates.push((r) => r[col] !== val); return b; },
    in: (col: string, vals: unknown[]) => { predicates.push((r) => vals.includes(r[col])); return b; },
    is: (col: string, val: unknown) => { predicates.push((r) => (r[col] ?? null) === val); return b; },
    not: (col: string, _operator: string, val: unknown) => { predicates.push((r) => (r[col] ?? null) !== val); return b; },
    gt: (col: string, val: unknown) => { predicates.push((r) => (r[col] as number | string) > (val as number | string)); return b; },
    gte: (col: string, val: unknown) => { predicates.push((r) => (r[col] as number | string) >= (val as number | string)); return b; },
    lt: (col: string, val: unknown) => { predicates.push((r) => (r[col] as number | string) < (val as number | string)); return b; },
    lte: (col: string, val: unknown) => { predicates.push((r) => (r[col] as number | string) <= (val as number | string)); return b; },
    like: (col: string, pat: string) => { predicates.push((r) => likeToRegExp(pat, '').test(String(r[col] ?? ''))); return b; },
    ilike: (col: string, pat: string) => { predicates.push((r) => likeToRegExp(pat, 'i').test(String(r[col] ?? ''))); return b; },
    contains: (col: string, val: unknown) => {
      predicates.push((r) => Array.isArray(r[col]) && Array.isArray(val) && val.every((x) => (r[col] as unknown[]).includes(x)));
      return b;
    },
    match: (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) predicates.push((r) => r[k] === v); return b; },
    update: (v: unknown) => { op = 'update'; values = v; return b; },
    insert: (v: unknown) => { op = 'insert'; values = v; return b; },
    upsert: (v: unknown) => { op = 'upsert'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const rows = run();
      return Promise.resolve({
        data: selectOpts.head ? null : rows,
        error: null,
        count: selectOpts.count ? rows.length : null,
      }).then(resolve, reject);
    },
  };
  // Any other builder method (textSearch, overlaps, csv, abortSignal, returns, …) is accepted and ignored.
  return new Proxy(b, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string') return () => target;
      return undefined;
    },
  });
}

function rpcAnswer(db: FakeDb, name: string, args: unknown): { data: unknown; error: null } {
  (db.rpcCalls ??= []).push({ name, args });
  const hit = db.rpc?.[name];
  return { data: typeof hit === 'function' ? (hit as (a: unknown) => unknown)(args) : (hit ?? null), error: null };
}

function adminAuth(db: FakeDb) {
  return {
    admin: {
      getUserById: async (id: string) => ({ data: { user: db.authUsers?.[id] ? { id, ...db.authUsers[id] } : null }, error: null }),
    },
  };
}

const storage = {
  from: () => ({
    createSignedUrl: async () => ({ data: null, error: { message: 'no storage in the fake' } }),
    download: async () => ({ data: null, error: { message: 'no storage in the fake' } }),
    remove: async () => ({ data: null, error: null }),
    upload: async () => ({ data: null, error: null }),
  }),
};

/** A service-role style client over `db`: no session, no RLS, filters only. */
export function fakeAdmin(db: FakeDb): SupabaseClient {
  return {
    from: (table: string) => builder(db, table),
    rpc: async (name: string, args?: unknown) => rpcAnswer(db, name, args),
    auth: adminAuth(db),
    storage,
  } as unknown as SupabaseClient;
}

/** The request-scoped (cookie session) client: a signed-in user, plus the
 * `is_ablute_developer` rpc every viewer check goes through. */
export function fakeSession(db: FakeDb, opts: { userId: string; isDeveloper: boolean; email?: string }): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: opts.userId, email: opts.email ?? `${opts.userId}@example.test`, email_confirmed_at: '2026-01-01T00:00:00Z' } } }),
    },
    from: (table: string) => builder(db, table),
    rpc: async (name: string, args?: unknown) => {
      if (name === 'is_ablute_developer') return { data: opts.isDeveloper, error: null };
      return rpcAnswer(db, name, args);
    },
    storage,
  } as unknown as SupabaseClient;
}
