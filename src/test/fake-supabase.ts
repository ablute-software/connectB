// Prompt 902 — a tiny in-memory stand-in for the slice of supabase-js the
// founder-side routes use, so a route test can assert on WHICH rows came back
// instead of on which methods were called. The point of the viewer-org tests is
// "caller is a member of org A, viewing org B → only B's data": that needs real
// `.eq('org_id', …)` filtering, not a mock that returns whatever it was given.
//
// Deliberately small: eq / in / is / not / neq filter for real; select, order,
// limit and range are accepted and ignored; update / insert / delete are
// recorded in `db.writes` (and applied to nothing — a test asserts on the
// record, never on the resulting table). maybeSingle()/single() return the
// first match, which is enough for the one-membership-per-user fixtures here.
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
}

export function fakeDb(tables: Record<string, Row[]>): FakeDb {
  return { tables, writes: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(db: FakeDb, table: string): any {
  const predicates: ((r: Row) => boolean)[] = [];
  const eqs: [string, unknown][] = [];
  let op: Write['op'] | null = null;
  let values: unknown;

  const run = (): Row[] => {
    const rows = (db.tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
    if (op) db.writes.push({ table, op, values, eqs: [...eqs] });
    return rows;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => b,
    range: () => b,
    eq: (col: string, val: unknown) => { eqs.push([col, val]); predicates.push((r) => r[col] === val); return b; },
    neq: (col: string, val: unknown) => { predicates.push((r) => r[col] !== val); return b; },
    in: (col: string, vals: unknown[]) => { predicates.push((r) => vals.includes(r[col])); return b; },
    is: (col: string, val: unknown) => { predicates.push((r) => (r[col] ?? null) === val); return b; },
    not: (col: string, _operator: string, val: unknown) => { predicates.push((r) => (r[col] ?? null) !== val); return b; },
    update: (v: unknown) => { op = 'update'; values = v; return b; },
    insert: (v: unknown) => { op = 'insert'; values = v; return b; },
    upsert: (v: unknown) => { op = 'upsert'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(resolve, reject),
  };
  return b;
}

/** A service-role style client over `db`: no session, no RLS, filters only. */
export function fakeAdmin(db: FakeDb): SupabaseClient {
  return { from: (table: string) => builder(db, table) } as unknown as SupabaseClient;
}

/** The request-scoped (cookie session) client: a signed-in user, plus the
 * `is_ablute_developer` rpc every viewer check goes through. */
export function fakeSession(db: FakeDb, opts: { userId: string; isDeveloper: boolean }): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: opts.userId } } }) },
    from: (table: string) => builder(db, table),
    rpc: async (name: string) => ({ data: name === 'is_ablute_developer' ? opts.isDeveloper : null, error: null }),
  } as unknown as SupabaseClient;
}
