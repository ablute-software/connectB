import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligiblePipelineOrgIds, eligibleOrgIds } from './portal-access';

// Prompt 556 — REPLACES the rule Prompt 184's version of this file pinned
// (isProfileGateComplete alone, MatchDeal ignored entirely). Discovery is
// once again the founder's explicit publication act — a startup
// matchdeal_profiles row with is_visible = true — with closed and suspended
// orgs excluded. The full reasoning, including why Caramel Biscuit's
// original symptom is now the intended answer rather than a bug, is in
// pipeline-eligibility.ts's header; the rules themselves are unit-tested
// against the pure core in pipeline-eligibility.test.ts.
//
// What THIS file still pins is the wiring, which the pure core can't: that
// eligiblePipelineOrgIds issues exactly two reads — `.from('orgs')
// .select('*')` (unfiltered; every rule is applied in JS, so a column a
// migration hasn't added yet can never make the query fail) and
// `.from('matchdeal_profiles').select(...).eq('kind','startup')
// .in('membership_id', ...)` — and that it feeds both to the pure core.
type FakeOrg = {
  id: string;
  website?: string | null; sectors?: string[] | null; sectors_other?: string | null;
  stage?: string | null; country?: string | null; round_target_eur?: number | null;
  current_phase?: string | null; founded_year?: number | null; revenue_eur?: number | null;
  primary_contact_person_id?: string | null;
  owner_suspended_at?: string | null; platform_suspended_at?: string | null;
  closed_at?: string | null; is_test?: boolean;
};
type FakeMatchDealProfile = { membership_id: string; is_visible?: boolean; owner_suspended_at?: string | null; platform_suspended_at?: string | null };

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

// The CRM profile-gate fields are kept on the fixture on purpose: after
// Prompt 556 they must make NO difference to this function, and a fixture
// that still carries them is what proves it.
function completeOrg(id: string, extra: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id, website: 'https://caramelbiscuit.co', sectors: ['fintech'], stage: 'seed', country: 'Portugal',
    round_target_eur: 500_000, current_phase: 'pilot', founded_year: 2024, revenue_eur: 0,
    primary_contact_person_id: 'person-1', ...extra,
  };
}

function publishedProfile(id: string, extra: Partial<FakeMatchDealProfile> = {}): FakeMatchDealProfile {
  return { membership_id: id, is_visible: true, ...extra };
}

describe('eligiblePipelineOrgIds', () => {
  it('includes an org whose founder published to MatchDeal', async () => {
    const admin = fakeAdmin([completeOrg('org-ablute')], [publishedProfile('org-ablute')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-ablute']);
  });

  // The reversal of Prompt 184, stated as a test: a CRM-complete org that
  // never published is NOT discoverable, and its About tab says exactly
  // that. This is the case Nuno hit on 03/09 from the other side — four
  // orgs shown "Investors can't find you yet" while investors could.
  it('excludes a CRM-complete org that has never published, and a CRM-complete org with no MatchDeal row at all', async () => {
    const notPublished = fakeAdmin([completeOrg('org-estojo')], [publishedProfile('org-estojo', { is_visible: false })]);
    expect(await eligiblePipelineOrgIds(notPublished, false)).toEqual([]);

    const noProfileRow = fakeAdmin([completeOrg('org-caramel-biscuit')], []);
    expect(await eligiblePipelineOrgIds(noProfileRow, false)).toEqual([]);
  });

  // Krohnsty 54f1bf67 — deleted account, all nine gate fields still filled
  // in, still being served to every investor. The whole reason for §A.
  it('excludes a closed org (orgs.closed_at) even when its profile still reads published', async () => {
    const admin = fakeAdmin([completeOrg('org-krohnsty', { closed_at: '2026-09-03T17:25:38Z' })], [publishedProfile('org-krohnsty')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('never depends on access_grants — a published org with zero grants is still eligible', async () => {
    const admin = fakeAdmin(
      [completeOrg('org-ablute'), completeOrg('org-second')],
      [publishedProfile('org-ablute'), publishedProfile('org-second')],
    );
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(expect.arrayContaining(['org-ablute', 'org-second']));
  });

  it('excludes an org suspended via orgs.owner_suspended_at (the post-migration-0168 path)', async () => {
    const admin = fakeAdmin([completeOrg('org-suspended', { owner_suspended_at: '2026-08-01T00:00:00Z' })], [publishedProfile('org-suspended')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('excludes an org suspended via orgs.platform_suspended_at', async () => {
    const admin = fakeAdmin([completeOrg('org-platform-suspended', { platform_suspended_at: '2026-08-01T00:00:00Z' })], [publishedProfile('org-platform-suspended')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('excludes an org suspended only via the OLD matchdeal_profiles path (pre-migration data, defense in depth)', async () => {
    const admin = fakeAdmin(
      [completeOrg('org-legacy-suspended')],
      [publishedProfile('org-legacy-suspended', { owner_suspended_at: '2026-07-01T00:00:00Z' })],
    );
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('includes a suspended-and-then-unsuspended published org (both timestamps null again)', async () => {
    const admin = fakeAdmin([completeOrg('org-back', { owner_suspended_at: null, platform_suspended_at: null })], [publishedProfile('org-back')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-back']);
  });

  // The CRM gate is gone from this decision entirely, in BOTH directions:
  // an incomplete-but-published org is now eligible, which it was not
  // before. That is the point — the gate is the founder's own Pipeline
  // unlock (pipeline-unlock.ts), never a statement about investors.
  it('ignores the CRM profile gate completely — an incomplete but published org is eligible', async () => {
    const admin = fakeAdmin([completeOrg('org-incomplete', { website: null, primary_contact_person_id: null })], [publishedProfile('org-incomplete')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-incomplete']);
  });

  it('hides a test org from a real viewer and shows it to a test viewer', async () => {
    const admin = fakeAdmin([completeOrg('org-test', { is_test: true })], [publishedProfile('org-test')]);
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
