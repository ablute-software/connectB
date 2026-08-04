import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligiblePipelineOrgIds } from './portal-access';

// Prompt 120 Block A / Prompt 121 §2.7-a — permanent regression test: a
// startup's Pipeline eligibility must be driven by its published MatchDeal
// profile alone, never by whether some investor happens to hold an
// access_grants row for it. The root-cause bug this guards against is
// exactly the one the prompt found: eligibility silently pinned to grants,
// with the "revisit" condition sitting in a code comment nobody watched.
// A minimal fake client is used rather than a real Supabase connection —
// eligiblePipelineOrgIds issues exactly one
// `.from('matchdeal_profiles').select(...).eq('kind', ...).eq('is_visible', ...)`
// call, so faking that one chain is enough to pin the behavior without
// standing up integration infrastructure this codebase doesn't otherwise use.
function fakeAdmin(profiles: { kind: string; is_visible: boolean; membership_id: string }[]) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(col1: string, val1: unknown) {
              const afterFirst = profiles.filter((p) => (p as Record<string, unknown>)[col1] === val1);
              return {
                eq(col2: string, val2: unknown) {
                  const afterSecond = afterFirst.filter((p) => (p as Record<string, unknown>)[col2] === val2);
                  return Promise.resolve({ data: afterSecond.map((p) => ({ membership_id: p.membership_id })) });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('eligiblePipelineOrgIds', () => {
  it('includes a startup the moment its MatchDeal profile is published — no manual step', async () => {
    const admin = fakeAdmin([
      { kind: 'startup', is_visible: true, membership_id: 'org-caramel-biscuit' },
    ]);
    expect(await eligiblePipelineOrgIds(admin)).toEqual(['org-caramel-biscuit']);
  });

  it('excludes a startup profile that is not yet published (is_visible=false)', async () => {
    const admin = fakeAdmin([
      { kind: 'startup', is_visible: false, membership_id: 'org-not-ready' },
    ]);
    expect(await eligiblePipelineOrgIds(admin)).toEqual([]);
  });

  it('never depends on access_grants — a published org with zero grants is still eligible', async () => {
    // The fake admin here has no access_grants concept at all: eligibility
    // resolves purely from matchdeal_profiles, proving the two are decoupled.
    const admin = fakeAdmin([
      { kind: 'startup', is_visible: true, membership_id: 'org-ablute' },
      { kind: 'startup', is_visible: true, membership_id: 'org-caramel-biscuit' },
    ]);
    expect(await eligiblePipelineOrgIds(admin)).toEqual(expect.arrayContaining(['org-ablute', 'org-caramel-biscuit']));
  });

  it('excludes investor profiles', async () => {
    const admin = fakeAdmin([
      { kind: 'investor', is_visible: true, membership_id: 'investor-member-1' },
    ]);
    expect(await eligiblePipelineOrgIds(admin)).toEqual([]);
  });

  it('dedupes if a startup somehow has more than one matching profile row', async () => {
    const admin = fakeAdmin([
      { kind: 'startup', is_visible: true, membership_id: 'org-dup' },
      { kind: 'startup', is_visible: true, membership_id: 'org-dup' },
    ]);
    expect(await eligiblePipelineOrgIds(admin)).toEqual(['org-dup']);
  });
});
