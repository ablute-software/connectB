import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeDeliverable, UNLIMITED_QUOTA_SENTINEL } from './pipeline-unlock-server';

// Prompt 579 — production served "999989 more matched investors ready for
// you" to sherlockdeal.com@gmail.com: catalog_effective_quota() returned the
// 999999 is_ablute_developer() sentinel (migration 0166), and
// quota - delivered handed that straight to the screen. computeDeliverable
// is the one place both the GET route (what the banner shows) and the
// deliver route (what the button actually requests) get this number from,
// so it must never let the sentinel out, and must never promise more than
// catalog_top_matches actually has for this org.
function fakeAdminWithMatches(count: number): SupabaseClient {
  const matches = Array.from({ length: count }, (_, i) => ({ catalog_id: `c${i}`, score: 90 }));
  return { rpc: () => Promise.resolve({ data: matches, error: null }) } as unknown as SupabaseClient;
}

describe('computeDeliverable', () => {
  it('normal quota, real supply smaller than the remaining quota: capped by supply', async () => {
    // quota 50, delivered 10 -> 40 remaining, but only 12 real matches exist.
    const admin = fakeAdminWithMatches(12);
    const result = await computeDeliverable(admin, 'org-1', 50, 10);
    expect(result).toEqual({ deliverable: 12, unlimited: false });
  });

  it('normal quota, real supply larger than the remaining quota: capped by quota', async () => {
    // quota 8, delivered 3 -> 5 remaining, and 20 real matches exist.
    const admin = fakeAdminWithMatches(20);
    const result = await computeDeliverable(admin, 'org-1', 8, 3);
    expect(result).toEqual({ deliverable: 5, unlimited: false });
  });

  it('unlimited quota (the is_ablute_developer() sentinel): real supply, never the raw 999999', async () => {
    // The exact production shape: quota is the sentinel, 10 already
    // delivered, and the catalog holds far fewer than 999999 eligible rows.
    const admin = fakeAdminWithMatches(7);
    const result = await computeDeliverable(admin, 'org-1', UNLIMITED_QUOTA_SENTINEL, 10);
    expect(result).toEqual({ deliverable: 7, unlimited: true });
    expect(result.deliverable).not.toBe(UNLIMITED_QUOTA_SENTINEL - 10);
  });

  it('unlimited quota with nothing left in the catalog: 0, not a negative or the sentinel', async () => {
    const admin = fakeAdminWithMatches(0);
    const result = await computeDeliverable(admin, 'org-1', UNLIMITED_QUOTA_SENTINEL, 10);
    expect(result).toEqual({ deliverable: 0, unlimited: true });
  });

  it('a spent normal quota offers nothing, even if the catalog has more', async () => {
    const admin = fakeAdminWithMatches(30);
    const result = await computeDeliverable(admin, 'org-1', 8, 8);
    expect(result).toEqual({ deliverable: 0, unlimited: false });
  });
});
