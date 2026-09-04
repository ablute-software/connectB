import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverCatalogMatches } from './catalog-delivery-core';

// Prompt 536 §2 — the foreign-key race, pinned.
//
// The client-side unlockPack fired entities, pack_unlocks and
// catalog_deliveries as three parallel fire-and-forget persist() calls.
// catalog_deliveries.entity_id references entities.id, so in production
// (Krohnsty, 2026-09-02 13:22:56.577) the deliveries insert hit
// "violates foreign key constraint catalog_deliveries_entity_id_fkey"
// 34ms after the entities insert, and persist() swallowed it into a
// console.error. Three investors, zero delivery rows, no error on screen.
//
// A unit test cannot observe wall-clock parallelism, but it can observe the
// two things that actually matter and that the old code got wrong: the
// ORDER the writes are issued in, and whether an insert error is returned
// or dropped. Both are asserted below.
function makeFakeAdmin(opts: {
  matches?: { catalog_id: string; score: number }[];
  catalogRows?: Record<string, unknown>[];
  ownedNames?: string[];
  entitiesInsertError?: string;
  deliveriesInsertError?: string;
  matchError?: string;
} = {}) {
  const writes: { table: string; payload: unknown }[] = [];

  function response(table: string) {
    if (table === 'catalog_entities') return { data: opts.catalogRows ?? [], error: null };
    if (table === 'entities') return { data: (opts.ownedNames ?? []).map((name) => ({ name })), error: null };
    // resolveClaimedInvestorProfile's three tables, plus enrichment lookups.
    return { data: [], error: null };
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    Object.assign(b, {
      select: self, eq: self, in: self, or: self, order: self, limit: self,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(response(table)).then(resolve),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: (payload: unknown) => {
        writes.push({ table, payload });
        const err = table === 'entities' ? opts.entitiesInsertError
          : table === 'catalog_deliveries' ? opts.deliveriesInsertError : undefined;
        return Promise.resolve({ data: null, error: err ? { message: err, code: 'X' } : null });
      },
    });
    return b;
  }

  const admin = {
    from: (table: string) => builder(table),
    rpc: (fn: string) => {
      if (fn === 'catalog_top_matches') {
        return Promise.resolve(opts.matchError
          ? { data: null, error: { message: opts.matchError } }
          : { data: opts.matches ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { admin, writes };
}

const THREE_MATCHES = [
  { catalog_id: 'c1', score: 90 }, { catalog_id: 'c2', score: 80 }, { catalog_id: 'c3', score: 70 },
];
const THREE_ROWS = [
  { id: 'c1', name: 'SFC Capital', moderation_status: 'active' },
  { id: 'c2', name: 'Mercia Ventures', moderation_status: 'active' },
  { id: 'c3', name: 'Seedcamp', moderation_status: 'active' },
];

describe('deliverCatalogMatches — entities before deliveries, always', () => {
  it('writes entities FIRST, then catalog_deliveries', async () => {
    const { admin, writes } = makeFakeAdmin({ matches: THREE_MATCHES, catalogRows: THREE_ROWS });
    await deliverCatalogMatches(admin, 'org-1', 3, null);
    const order = writes.map((w) => w.table);
    expect(order.indexOf('entities')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('catalog_deliveries')).toBeGreaterThan(order.indexOf('entities'));
  });

  it('every delivered entity gets exactly one delivery row, pointing at it', async () => {
    // The invariant the production data violated: 3 catalog entities, 0
    // delivery rows. Counts equal, and every entity_id references a row
    // this same call created.
    const { admin, writes } = makeFakeAdmin({ matches: THREE_MATCHES, catalogRows: THREE_ROWS });
    const result = await deliverCatalogMatches(admin, 'org-1', 3, null);

    const entities = writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[];
    const deliveries = writes.find((w) => w.table === 'catalog_deliveries')!.payload as Record<string, unknown>[];
    expect(result.delivered).toBe(3);
    expect(entities).toHaveLength(3);
    expect(deliveries).toHaveLength(entities.length);

    const entityIds = new Set(entities.map((e) => e.id as string));
    for (const d of deliveries) {
      expect(entityIds.has(d.entity_id as string)).toBe(true);
      expect(d.org_id).toBe('org-1');
      expect(d.quota_exempt).toBe(false);
    }
    expect(deliveries.map((d) => d.catalog_id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('a failed entities insert writes NO delivery rows and reports the error', async () => {
    // The inverse of the old bug: never a reference without its referent,
    // and never a silent console.error.
    const { admin, writes } = makeFakeAdmin({
      matches: THREE_MATCHES, catalogRows: THREE_ROWS, entitiesInsertError: 'boom',
    });
    const result = await deliverCatalogMatches(admin, 'org-1', 3, null);
    expect(result.delivered).toBe(0);
    expect(result.error).toBe('boom');
    expect(writes.some((w) => w.table === 'catalog_deliveries')).toBe(false);
  });

  it('a failed deliveries insert is RETURNED, not swallowed', async () => {
    // This is the exact failure production hit. It must reach the caller.
    const { admin } = makeFakeAdmin({
      matches: THREE_MATCHES, catalogRows: THREE_ROWS,
      deliveriesInsertError: 'insert or update on table "catalog_deliveries" violates foreign key constraint',
    });
    const result = await deliverCatalogMatches(admin, 'org-1', 3, null);
    expect(result.error).toContain('violates foreign key constraint');
  });

  it('respects p_limit and delivers nothing at or below zero', async () => {
    const { admin, writes } = makeFakeAdmin({ matches: THREE_MATCHES, catalogRows: THREE_ROWS });
    const result = await deliverCatalogMatches(admin, 'org-1', 0, null);
    expect(result.delivered).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('skips investors the org already owns by name, and writes no row for them', async () => {
    const { admin, writes } = makeFakeAdmin({
      matches: THREE_MATCHES, catalogRows: THREE_ROWS, ownedNames: ['seedcamp'],
    });
    const result = await deliverCatalogMatches(admin, 'org-1', 3, null);
    expect(result.delivered).toBe(2);
    const deliveries = writes.find((w) => w.table === 'catalog_deliveries')!.payload as Record<string, unknown>[];
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((d) => d.catalog_id)).not.toContain('c3');
  });

  it('never delivers a suspended catalog entity (Prompt 285 §3, preserved)', async () => {
    const { admin } = makeFakeAdmin({
      matches: THREE_MATCHES,
      catalogRows: [...THREE_ROWS.slice(0, 2), { id: 'c3', name: 'Seedcamp', moderation_status: 'suspended' }],
    });
    const result = await deliverCatalogMatches(admin, 'org-1', 3, null);
    expect(result.delivered).toBe(2);
    expect(result.deliveredIds).not.toContain('c3');
  });

  it('a match-query failure returns the reason and writes nothing', async () => {
    const { admin, writes } = makeFakeAdmin({ matchError: 'not authorized' });
    const result = await deliverCatalogMatches(admin, 'org-1', 5, null);
    expect(result).toMatchObject({ delivered: 0, error: 'not authorized' });
    expect(writes).toHaveLength(0);
  });

  it('records via_pack when one is given, null when not', async () => {
    const { admin, writes } = makeFakeAdmin({ matches: THREE_MATCHES, catalogRows: THREE_ROWS });
    await deliverCatalogMatches(admin, 'org-1', 3, 'pack-1');
    const deliveries = writes.find((w) => w.table === 'catalog_deliveries')!.payload as Record<string, unknown>[];
    expect(deliveries.every((d) => d.via_pack === 'pack-1')).toBe(true);
  });
});

// Prompt 536 §3 — "deliver up to quota", not "deliver once". The number the
// button shows and the number the route delivers are the same subtraction:
// quota minus non-exempt deliveries. Krohnsty had 8 and 3, and the old
// one-shot guard made the remaining 5 unreachable.
describe('Prompt 536 §3 — the top-up delivers exactly the difference', () => {
  const topUp = (quota: number, alreadyDelivered: number) => Math.max(0, quota - alreadyDelivered);

  it('Krohnsty: quota 8, delivered 3 -> 5 more', () => {
    expect(topUp(8, 3)).toBe(5);
  });

  it('after the §4 deck fix raises the quota to 10 -> 7 more', () => {
    expect(topUp(10, 3)).toBe(7);
  });

  it('a spent quota offers nothing, and never a negative', () => {
    expect(topUp(8, 8)).toBe(0);
    expect(topUp(8, 11)).toBe(0);
  });

  it('delivering the difference twice in a row is a no-op the second time', async () => {
    const { admin, writes } = makeFakeAdmin({ matches: THREE_MATCHES, catalogRows: THREE_ROWS });
    const first = await deliverCatalogMatches(admin, 'org-1', topUp(8, 5), null);
    expect(first.delivered).toBe(3);
    // Second call with the quota now spent: p_limit is 0, nothing is written.
    const before = writes.length;
    const second = await deliverCatalogMatches(admin, 'org-1', topUp(8, 8), null);
    expect(second.delivered).toBe(0);
    expect(writes).toHaveLength(before);
  });
});

// Prompt 565 — the delivered row carries the catalog's contacts.
//
// 50 rows across 4 orgs reached founders with submission_channel, email and
// key_people all empty while catalog_entities held all three for the same
// firms (Atomico's email and 12 investment-team people; Index Ventures' email
// and 9 partners). The delivery simply never copied them: catalogContactFields
// only entered this path on 03/09 (Prompt 544 Part C). A founder whose whole
// pipeline has no channel on any row fails readyToContact and next_approach
// alike, so Sherlock's Next Clue goes quiet — telling the truth about data
// that should never have looked like that.
//
// catalog-delivery-mapping.test.ts already covers the mapping function. What
// was missing, and what actually broke, is proof that THIS path calls it: the
// mapper can be perfect and the caller can still drop it on the floor.
describe('Prompt 565 — contact fields reach the delivered entity', () => {
  const enriched = {
    id: 'cat-1', name: 'Atomico', type: 'vc',
    email: 'hello@atomico.com',
    submission_channel: 'https://atomico.com/apply',
    key_people: 'Niklas Zennstrom (Partner); Hiro Tamura (Partner)',
    general_partner_emails: 'gp@atomico.com',
    aum: '4B', current_funds: 'Atomico VI', latest_fund: 'Atomico VI',
    last_investment_found: '2026-07-01',
  };

  it('copies every contact field from catalog_entities onto the new row', async () => {
    const { admin, writes } = makeFakeAdmin({
      matches: [{ catalog_id: 'cat-1', score: 90 }],
      catalogRows: [enriched],
    });
    const res = await deliverCatalogMatches(admin, 'org-1', 5, null);
    expect(res.delivered).toBe(1);

    const insert = writes.find((w) => w.table === 'entities');
    const row = (insert!.payload as Record<string, unknown>[])[0];

    expect(row.email).toBe('hello@atomico.com');
    expect(row.submission_channel).toBe('https://atomico.com/apply');
    expect(row.key_people).toBe('Niklas Zennstrom (Partner); Hiro Tamura (Partner)');
    // Derived, not copied — and previously hard-coded 'unknown', which is the
    // 564 §A half of the same defect.
    expect(row.submission_channel_type).toBe('form');
    // The fund facts travel on the same call; dropping them is the same bug.
    expect(row.general_partner_emails).toBe('gp@atomico.com');
    expect(row.aum).toBe('4B');
  });

  it('a founder never receives a row with no channel at all when the catalog has one', async () => {
    // The exact production symptom, stated as an invariant rather than as a
    // list of fields: whatever the catalog knows about how to reach a firm,
    // the delivered row knows too.
    const { admin, writes } = makeFakeAdmin({
      matches: [{ catalog_id: 'cat-1', score: 90 }],
      catalogRows: [enriched],
    });
    await deliverCatalogMatches(admin, 'org-1', 5, null);
    const row = (writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[])[0];
    const reachable = !!row.email || !!row.submission_channel || !!row.key_people;
    expect(reachable).toBe(true);
  });

  it('leaves the fields null when the catalog row genuinely has none', async () => {
    // Fail-closed the other way: no invented contacts, which is the other
    // half of the instruction. An empty catalog row stays empty.
    const { admin, writes } = makeFakeAdmin({
      matches: [{ catalog_id: 'cat-2', score: 50 }],
      catalogRows: [{ id: 'cat-2', name: 'Empty Ventures', type: 'vc' }],
    });
    await deliverCatalogMatches(admin, 'org-1', 5, null);
    const row = (writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[])[0];
    expect(row.email).toBeNull();
    expect(row.submission_channel).toBeNull();
    expect(row.key_people).toBeNull();
    expect(row.submission_channel_type).toBe('unknown');
  });
});
