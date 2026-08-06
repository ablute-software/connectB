import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toInvestorFacingLevelRows, requestInterestLevel, type InterestLevelRowFull } from './investor-interest-level-db';

// relatorio_verificacao_..._8143c75_p136 §3 — the founder's own private
// note used to ride along in the full row object sent to the investor's
// browser. This locks in the fix: the projection must drop `note` (and
// every other founder-internal field) regardless of what's added to
// InterestLevelRowFull in the future.
describe('toInvestorFacingLevelRows', () => {
  const full: InterestLevelRowFull[] = [
    {
      id: 'row-1', level: 3, status: 'denied', requestedAt: '2026-08-01T00:00:00.000Z', decidedAt: '2026-08-02T00:00:00.000Z',
      note: 'Denied — tried to lowball us last round.', shareDirectEmail: false,
    },
  ];

  it('keeps only level and status', () => {
    const result = toInvestorFacingLevelRows(full);
    expect(result).toEqual([{ level: 3, status: 'denied' }]);
  });

  it('never includes the founder\'s private note under any key', () => {
    const result = toInvestorFacingLevelRows(full);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('lowball');
    expect(Object.keys(result[0])).toEqual(['level', 'status']);
  });

  it('drops id, requestedAt, decidedAt, and shareDirectEmail too', () => {
    const result = toInvestorFacingLevelRows(full);
    expect('id' in result[0]).toBe(false);
    expect('requestedAt' in result[0]).toBe(false);
    expect('decidedAt' in result[0]).toBe(false);
    expect('shareDirectEmail' in result[0]).toBe(false);
    expect('note' in result[0]).toBe(false);
  });
});

// mini_prompt_commit_0134_0135_..._20260806 Bloco B — a minimal chainable
// fake standing in for supabase-js's query builder: `.select()`/`.eq()`
// return the same object (chainable, no-op for this test's purposes),
// `.maybeSingle()`/`.insert()`/`.update()` resolve per-table canned
// responses and record every insert/update call so the test can assert on
// exactly what was (or wasn't) written.
function makeFakeAdmin(opts: { deliveryEntityId: string | null }) {
  const calls: { table: string; op: 'insert' | 'update'; payload: Record<string, unknown> }[] = [];
  function builder(table: string) {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      insert: (payload: Record<string, unknown>) => { calls.push({ table, op: 'insert', payload }); return Promise.resolve({ data: null, error: null }); },
      update: (payload: Record<string, unknown>) => { calls.push({ table, op: 'update', payload }); return b; },
      maybeSingle: () => {
        if (table === 'investor_interest_levels') return Promise.resolve({ data: null, error: null }); // no existing row — not idempotent-skipped
        if (table === 'catalog_entities') return Promise.resolve({ data: { name: 'Acme Capital' }, error: null });
        if (table === 'catalog_deliveries') return Promise.resolve({ data: opts.deliveryEntityId ? { entity_id: opts.deliveryEntityId } : null, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { admin: { from: (table: string) => builder(table) } as unknown as SupabaseClient, calls };
}

// relatorio_verificacao_bloco2_..._20260806 §3 / mini_prompt Bloco B — a
// task inserted with entity_id = null can never be closed again
// (decideInterestLevel3 only closes by matching entity_id), so
// requestInterestLevel must skip the task entirely when catalog_deliveries
// has no row for this (org, investor) pair — not insert an unclosable one.
describe('requestInterestLevel — level 3, task creation vs catalog_deliveries coverage', () => {
  it('with no catalog_deliveries row: writes the level-3 request, skips the task', async () => {
    const { admin, calls } = makeFakeAdmin({ deliveryEntityId: null });
    const { error } = await requestInterestLevel(admin, { orgId: 'org-1', investorCatalogEntityId: 'inv-1', level: 3, userId: 'user-1' });
    expect(error).toBeNull();
    expect(calls.some((c) => c.table === 'investor_interest_levels' && c.op === 'insert')).toBe(true);
    expect(calls.some((c) => c.table === 'tasks' && c.op === 'insert')).toBe(false);
  });

  it('with a catalog_deliveries row present: writes both the level-3 request and the task', async () => {
    const { admin, calls } = makeFakeAdmin({ deliveryEntityId: 'entity-1' });
    const { error } = await requestInterestLevel(admin, { orgId: 'org-1', investorCatalogEntityId: 'inv-1', level: 3, userId: 'user-1' });
    expect(error).toBeNull();
    expect(calls.some((c) => c.table === 'investor_interest_levels' && c.op === 'insert')).toBe(true);
    const taskInsert = calls.find((c) => c.table === 'tasks' && c.op === 'insert');
    expect(taskInsert).toBeDefined();
    expect(taskInsert?.payload.entity_id).toBe('entity-1');
    expect(taskInsert?.payload.source).toBe('interest_level_request');
  });
});
