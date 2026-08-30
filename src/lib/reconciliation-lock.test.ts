// Prompt 480 — the org-level reconciliation lock. Exercised against a
// hand-rolled fake SupabaseClient, same pattern as reconciliation.test.ts:
// the properties that matter here (a second caller never runs alongside the
// first; a dead holder never wedges an org forever) are about the
// acquire/release protocol, which is fully testable without a live Postgres.
//
// Time and sleeping are injected so the waiting paths run instantly — a
// test that actually slept 15s to prove a 15s budget would never be run.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  acquireReconciliationLock, releaseReconciliationLock, isLockStale,
  LOCK_STALE_AFTER_MS, DEFAULT_LOCK_WAIT_MS, FAST_ROUTE_LOCK_WAIT_MS,
} from './reconciliation-lock';

// A fake that behaves like the real table: org_id is a primary key, so a
// second insert for a held org inserts nothing and returns no rows —
// exactly what `on conflict do nothing returning org_id` does.
function makeFakeLockTable(initial: { org_id: string; locked_at: string }[] = []) {
  const rows = [...initial];
  const admin = {
    from: (table: string) => {
      if (table !== 'reconciliation_locks') throw new Error(`unexpected table: ${table}`);
      return {
        upsert: (payload: { org_id: string }) => ({
          select: () => {
            const held = rows.some((r) => r.org_id === payload.org_id);
            if (held) return Promise.resolve({ data: [], error: null });
            rows.push({ org_id: payload.org_id, locked_at: new Date(NOW_BASE).toISOString() });
            return Promise.resolve({ data: [{ org_id: payload.org_id }], error: null });
          },
        }),
        select: () => ({
          eq: (_c: string, orgId: string) => ({
            maybeSingle: () => Promise.resolve({ data: rows.find((r) => r.org_id === orgId) ?? null, error: null }),
          }),
        }),
        delete: () => {
          const filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              // The real client resolves on await; both the 1-filter
              // (release) and 2-filter (guarded stale takeover) forms end
              // here, so applying on each eq and being idempotent is safe.
              const before = rows.length;
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i] as unknown as Record<string, string>;
                if (Object.entries(filters).every(([k, v]) => r[k] === v)) rows.splice(i, 1);
              }
              return Object.assign(Promise.resolve({ data: null, error: null, count: before - rows.length }), chain);
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, rows };
}

const NOW_BASE = Date.parse('2026-08-30T18:00:00.000Z');

describe('isLockStale — when a holder must be assumed dead', () => {
  it('a lock taken just now is not stale', () => {
    expect(isLockStale(new Date(NOW_BASE).toISOString(), NOW_BASE + 1_000)).toBe(false);
  });

  it('a lock older than 90s is stale — past the slowest route\'s own maxDuration=60', () => {
    expect(isLockStale(new Date(NOW_BASE).toISOString(), NOW_BASE + LOCK_STALE_AFTER_MS + 1)).toBe(true);
  });

  it('exactly at the threshold is NOT yet stale — a run still inside its budget keeps its lock', () => {
    expect(isLockStale(new Date(NOW_BASE).toISOString(), NOW_BASE + LOCK_STALE_AFTER_MS)).toBe(false);
  });

  it('an unparseable timestamp counts as stale — a row we cannot reason about must never block an org forever', () => {
    expect(isLockStale('not a date', NOW_BASE)).toBe(true);
  });
});

describe('acquireReconciliationLock', () => {
  it('acquires when nothing holds the lock', async () => {
    const { admin, rows } = makeFakeLockTable();
    expect(await acquireReconciliationLock(admin, 'org-1', { nowMs: () => NOW_BASE })).toBe('acquired');
    expect(rows).toHaveLength(1);
  });

  it('a second caller for the SAME org does not acquire while the first holds it — the whole point', async () => {
    const { admin } = makeFakeLockTable();
    const nowMs = () => NOW_BASE;
    expect(await acquireReconciliationLock(admin, 'org-1', { nowMs })).toBe('acquired');
    // Budget 0 so it gives up immediately rather than polling.
    expect(await acquireReconciliationLock(admin, 'org-1', { nowMs, waitBudgetMs: 0 })).toBe('busy');
  });

  it('a different org is never blocked by another org\'s lock', async () => {
    const { admin } = makeFakeLockTable();
    const nowMs = () => NOW_BASE;
    expect(await acquireReconciliationLock(admin, 'org-1', { nowMs })).toBe('acquired');
    expect(await acquireReconciliationLock(admin, 'org-2', { nowMs })).toBe('acquired');
  });

  it('waits and then acquires when the holder releases within the budget (§3, the happy waiting path)', async () => {
    const { admin, rows } = makeFakeLockTable([{ org_id: 'org-1', locked_at: new Date(NOW_BASE).toISOString() }]);
    let clock = NOW_BASE;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
      // The first holder finishes during our very first wait.
      rows.splice(0, rows.length);
    });
    const result = await acquireReconciliationLock(admin, 'org-1', { nowMs: () => clock, sleep, waitBudgetMs: DEFAULT_LOCK_WAIT_MS });
    expect(result).toBe('acquired');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up with "busy" — never an error — when the holder never releases (§3: the request still succeeds, just unreconciled)', async () => {
    const { admin } = makeFakeLockTable([{ org_id: 'org-1', locked_at: new Date(NOW_BASE).toISOString() }]);
    let clock = NOW_BASE;
    const sleep = async (ms: number) => { clock += ms; };
    const result = await acquireReconciliationLock(admin, 'org-1', { nowMs: () => clock, sleep, waitBudgetMs: DEFAULT_LOCK_WAIT_MS });
    expect(result).toBe('busy');
    // It really did wait roughly the budget rather than returning at once.
    expect(clock - NOW_BASE).toBeGreaterThanOrEqual(DEFAULT_LOCK_WAIT_MS - 2_000);
  });

  it('takes over a STALE lock instead of waiting forever (§4, self-recovery)', async () => {
    const dead = new Date(NOW_BASE - LOCK_STALE_AFTER_MS - 5_000).toISOString();
    const { admin, rows } = makeFakeLockTable([{ org_id: 'org-1', locked_at: dead }]);
    const result = await acquireReconciliationLock(admin, 'org-1', { nowMs: () => NOW_BASE, waitBudgetMs: 0 });
    expect(result).toBe('acquired');
    expect(rows).toHaveLength(1);
    expect(rows[0].locked_at).not.toBe(dead); // the dead row was replaced, not honoured
  });

  it('the fast-route budget is genuinely shorter than the default — /api/blueprint cannot afford 15s', () => {
    expect(FAST_ROUTE_LOCK_WAIT_MS).toBeLessThan(DEFAULT_LOCK_WAIT_MS);
  });
});

describe('releaseReconciliationLock', () => {
  it('removes the lock so the next caller acquires immediately', async () => {
    const { admin, rows } = makeFakeLockTable();
    const nowMs = () => NOW_BASE;
    await acquireReconciliationLock(admin, 'org-1', { nowMs });
    await releaseReconciliationLock(admin, 'org-1');
    expect(rows).toHaveLength(0);
    expect(await acquireReconciliationLock(admin, 'org-1', { nowMs })).toBe('acquired');
  });

  it('releases only its own org', async () => {
    const { admin, rows } = makeFakeLockTable();
    const nowMs = () => NOW_BASE;
    await acquireReconciliationLock(admin, 'org-1', { nowMs });
    await acquireReconciliationLock(admin, 'org-2', { nowMs });
    await releaseReconciliationLock(admin, 'org-1');
    expect(rows.map((r) => r.org_id)).toEqual(['org-2']);
  });
});

describe('the acquire loop is bounded (adversarial pass, Prompt 480)', () => {
  it('a lock row that keeps vanishing between insert and read can never spin forever', async () => {
    // The pathological shape the bound exists for: every insert reports the
    // lock as held, and every read reports it as gone. Both retry paths in
    // the loop deliberately skip the wait budget, so without the attempt
    // ceiling this would never return.
    let inserts = 0;
    const admin = {
      from: () => ({
        upsert: () => ({ select: () => { inserts++; return Promise.resolve({ data: [], error: null }); } }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }),
    } as unknown as SupabaseClient;

    const result = await acquireReconciliationLock(admin, 'org-1', {
      nowMs: () => NOW_BASE, sleep: async () => {}, waitBudgetMs: DEFAULT_LOCK_WAIT_MS,
    });
    expect(result).toBe('busy');
    expect(inserts).toBeLessThanOrEqual(12); // bounded, not unbounded
  });
});
