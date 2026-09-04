import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligiblePipelineOrgIds, eligibleOrgIds } from './portal-access';

// Prompt 850 §A — REPLACES the rule Prompt 556 §B's version of this file
// pinned (matchdeal_profiles.is_visible, the MatchDeal publish act).
// Eligibility is THE ACCOUNT: the founder's own nine-field profile gate,
// minus closed, suspended (owner/platform), back-office moderated, and
// out-of-cohort orgs. The full reasoning is in pipeline-eligibility.ts's
// header; the rules themselves are unit-tested against the pure core in
// pipeline-eligibility.test.ts.
//
// What THIS file still pins is the wiring, which the pure core can't: that
// eligiblePipelineOrgIds issues exactly two reads — `.from('orgs')
// .select('*')` (unfiltered; every rule is applied in JS, so a column a
// migration hasn't added yet can never make the query fail) and
// `.from('matchdeal_profiles').select(...).eq('kind','startup')
// .in('membership_id', ...)` — and that it feeds both to the pure core.
// The second read survives Prompt 850 for one reason only: the suspension
// pair the visibility route dual-writes there.
type FakeOrg = {
  id: string;
  website?: string | null; sectors?: string[] | null; sectors_other?: string | null;
  stage?: string | null; country?: string | null; round_target_eur?: number | null;
  current_phase?: string | null; founded_year?: number | null; revenue_eur?: number | null;
  primary_contact_person_id?: string | null;
  owner_suspended_at?: string | null; platform_suspended_at?: string | null;
  closed_at?: string | null; is_test?: boolean;
  moderation_status?: 'active' | 'suspended' | 'deleted'; moderation_suspended_until?: string | null;
};
// is_visible is deliberately NOT on this fixture any more: Prompt 850 §A
// removed it from the decision AND from the route's select list, so a test
// that still supplied it would be pinning a column nobody reads.
type FakeMatchDealProfile = { membership_id: string; owner_suspended_at?: string | null; platform_suspended_at?: string | null };

function fakeAdmin(orgs: FakeOrg[], matchDealProfiles: FakeMatchDealProfile[] = []) {
  return {
    from(table: string) {
      if (table === 'orgs') {
        return { select: (_cols: string) => Promise.resolve({ data: orgs }) };
      }
      if (table === 'matchdeal_profiles') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  in(_col2: string, ids: string[]) {
                    return Promise.resolve({ data: matchDealProfiles.filter((p) => ids.includes(p.membership_id)) });
                  },
                };
              },
            };
          },
        };
      }
      return { select: () => Promise.resolve({ data: [] }) };
    },
  } as unknown as SupabaseClient;
}

// The nine CRM profile-gate fields — after Prompt 850 §A these ARE the
// decision, so the fixture spells them out rather than mocking the gate.
function completeOrg(id: string, extra: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id, website: 'https://caramelbiscuit.co', sectors: ['fintech'], stage: 'seed', country: 'Portugal',
    round_target_eur: 500_000, current_phase: 'pilot', founded_year: 2024, revenue_eur: 0,
    primary_contact_person_id: 'person-1', ...extra,
  };
}

function profileRow(id: string, extra: Partial<FakeMatchDealProfile> = {}): FakeMatchDealProfile {
  return { membership_id: id, ...extra };
}

describe('eligiblePipelineOrgIds', () => {
  it('includes a complete, open, non-test org', async () => {
    const admin = fakeAdmin([completeOrg('org-ablute')], [profileRow('org-ablute')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-ablute']);
  });

  // Prompt 850 §A, stated as a wiring test: publication on MatchDeal is no
  // longer part of this answer, and a missing matchdeal_profiles row is no
  // longer a disqualification. These are the exact two production shapes —
  // Sherlock Deal / Krohnsty 70a354f2 have an unpublished row; an org that
  // never opened MatchDeal has none.
  it('includes a complete org whether its MatchDeal row is unpublished or absent entirely', async () => {
    const unpublished = fakeAdmin([completeOrg('org-sherlock')], [profileRow('org-sherlock')]);
    expect(await eligiblePipelineOrgIds(unpublished, false)).toEqual(['org-sherlock']);

    const noProfileRow = fakeAdmin([completeOrg('org-caramel-biscuit')], []);
    expect(await eligiblePipelineOrgIds(noProfileRow, false)).toEqual(['org-caramel-biscuit']);
  });

  it('excludes an org whose founder profile gate is incomplete', async () => {
    const admin = fakeAdmin([completeOrg('org-incomplete', { website: null, primary_contact_person_id: null })], [profileRow('org-incomplete')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  // Krohnsty 54f1bf67 — deleted account, all nine gate fields still filled
  // in, still being served to every investor. Prompt 556 §A, unchanged.
  it('excludes a closed org (orgs.closed_at) even when the gate is complete', async () => {
    const admin = fakeAdmin([completeOrg('org-krohnsty', { closed_at: '2026-09-03T17:25:38Z' })], [profileRow('org-krohnsty')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  // Estojo, live: back-office suspended 02/09 10:27 UTC, still admitted to
  // a brand-new investor's pipeline 04/09 09:03 because nothing in
  // production called isVisibleToOthers. Prompt 850 §A's own reason.
  it('excludes a back-office suspended org, and lets a lapsed time-box restore it', async () => {
    const suspended = fakeAdmin([completeOrg('org-estojo', { moderation_status: 'suspended' })], [profileRow('org-estojo')]);
    expect(await eligiblePipelineOrgIds(suspended, false)).toEqual([]);

    const deleted = fakeAdmin([completeOrg('org-gone', { moderation_status: 'deleted' })], []);
    expect(await eligiblePipelineOrgIds(deleted, false)).toEqual([]);

    const lapsed = fakeAdmin([completeOrg('org-back', { moderation_status: 'suspended', moderation_suspended_until: '2020-01-01T00:00:00Z' })], []);
    expect(await eligiblePipelineOrgIds(lapsed, false)).toEqual(['org-back']);
  });

  it('never depends on access_grants — a complete org with zero grants is still eligible', async () => {
    const admin = fakeAdmin(
      [completeOrg('org-ablute'), completeOrg('org-second')],
      [profileRow('org-ablute'), profileRow('org-second')],
    );
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(expect.arrayContaining(['org-ablute', 'org-second']));
  });

  it('excludes an org suspended via orgs.owner_suspended_at (the post-migration-0168 path)', async () => {
    const admin = fakeAdmin([completeOrg('org-suspended', { owner_suspended_at: '2026-08-01T00:00:00Z' })], [profileRow('org-suspended')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('excludes an org suspended via orgs.platform_suspended_at', async () => {
    const admin = fakeAdmin([completeOrg('org-platform-suspended', { platform_suspended_at: '2026-08-01T00:00:00Z' })], [profileRow('org-platform-suspended')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  // The one thing the second read is still for.
  it('excludes an org suspended only via the OLD matchdeal_profiles path (pre-migration data, defense in depth)', async () => {
    const admin = fakeAdmin(
      [completeOrg('org-legacy-suspended')],
      [profileRow('org-legacy-suspended', { owner_suspended_at: '2026-07-01T00:00:00Z' })],
    );
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('includes a suspended-and-then-unsuspended org (both timestamps null again)', async () => {
    const admin = fakeAdmin([completeOrg('org-back', { owner_suspended_at: null, platform_suspended_at: null })], [profileRow('org-back')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-back']);
  });

  it('hides a test org from a real viewer and shows it to a test viewer', async () => {
    const admin = fakeAdmin([completeOrg('org-test', { is_test: true })], [profileRow('org-test')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
    expect(await eligiblePipelineOrgIds(admin, true)).toEqual(['org-test']);
  });
});

// Prompt 336 — @ablute.pt/nunomarujo@gmail.com are real investors now; the
// domain-keyed "no real grant, fall back to your own org" bypass this
// function used to have (is_ablute_developer()) is gone outright. With zero
// active access_grants, the answer is empty for EVERY caller, no exceptions
// — never a call to any RPC that could resurrect the old fallback.
describe('eligibleOrgIds — no QA/domain fallback survives (Prompt 336)', () => {
  function fakeGrantsAdmin(grants: { org_id: string; confirmed_at?: string | null; invited_email?: string | null; revoked_at?: string | null; expires_at?: string | null }[]) {
    return {
      from: (table: string) => {
        if (table === 'access_grants') {
          return { select: () => ({ is: () => ({ or: () => Promise.resolve({ data: grants }) }) }) };
        }
        throw new Error(`unexpected table ${table} — eligibleOrgIds must never touch org_members or rpc('is_ablute_developer') anymore`);
      },
      rpc: () => { throw new Error('eligibleOrgIds must never call an RPC anymore'); },
    } as unknown as SupabaseClient;
  }

  it('returns empty with zero grants — no org_members fallback, no RPC call', async () => {
    const admin = fakeGrantsAdmin([]);
    expect(await eligibleOrgIds(admin, admin, 'user-1', 'someone@ablute.pt', null)).toEqual([]);
  });

  it('returns real granted orgs exactly like any other investor — same as activeGrantOrgIds alone', async () => {
    const admin = fakeGrantsAdmin([{ org_id: 'org-real', invited_email: null, revoked_at: null, expires_at: null }]);
    expect(await eligibleOrgIds(admin, admin, 'user-1', 'nunomarujo@ablute.pt', null)).toEqual(['org-real']);
  });
});
