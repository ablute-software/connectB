import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligiblePipelineOrgIds } from './portal-access';

// Prompt 184 — REPLACES the Prompt 120/121 regression test this file used
// to encode: eligibility used to be pinned to matchdeal_profiles.is_visible
// (a published MatchDeal profile), which turned out to be the wrong axis
// entirely — Nuno's decision is that MatchDeal is an extra tool, never a
// requirement to appear in an investor's Pipeline. The bug that decision
// closes, confirmed live with "Caramel Biscuit": a CRM-complete org with
// ZERO matchdeal_profiles rows (never opened MatchDeal) was permanently
// excluded. These tests pin the NEW rule instead: isProfileGateComplete()
// alone, suspension checked from both orgs (new) and matchdeal_profiles
// (old, kept in sync by the toggle's dual-write) so nothing already
// suspended can silently reappear.
//
// A minimal fake client is used rather than a real Supabase connection —
// eligiblePipelineOrgIds issues exactly two calls: `.from('orgs').select(...)`
// (no filter — filtering happens in JS via isProfileGateComplete) and
// `.from('matchdeal_profiles').select(...).eq('kind', ...).in('membership_id', ...)`.
type FakeOrg = {
  id: string;
  website?: string | null; sectors?: string[] | null; sectors_other?: string | null;
  stage?: string | null; country?: string | null; round_target_eur?: number | null;
  current_phase?: string | null; founded_year?: number | null; revenue_eur?: number | null;
  primary_contact_person_id?: string | null;
  owner_suspended_at?: string | null; platform_suspended_at?: string | null;
};
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

// A fully complete CRM profile gate, per isProfileGateComplete's own field list.
function completeOrg(id: string, extra: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id, website: 'https://caramelbiscuit.co', sectors: ['fintech'], stage: 'seed', country: 'Portugal',
    round_target_eur: 500_000, current_phase: 'pilot', founded_year: 2024, revenue_eur: 0,
    primary_contact_person_id: 'person-1', ...extra,
  };
}

describe('eligiblePipelineOrgIds', () => {
  it('includes a CRM-complete org that has NEVER touched MatchDeal — zero matchdeal_profiles rows', async () => {
    const admin = fakeAdmin([completeOrg('org-caramel-biscuit')], []);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-caramel-biscuit']);
  });

  it('excludes an org whose CRM profile gate is not complete, regardless of MatchDeal state', async () => {
    const admin = fakeAdmin([completeOrg('org-incomplete', { website: null })]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('never depends on access_grants — a complete org with zero grants is still eligible', async () => {
    const admin = fakeAdmin([completeOrg('org-ablute'), completeOrg('org-caramel-biscuit')]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(expect.arrayContaining(['org-ablute', 'org-caramel-biscuit']));
  });

  it('excludes an org suspended via orgs.owner_suspended_at (the new, post-migration path)', async () => {
    const admin = fakeAdmin([completeOrg('org-suspended', { owner_suspended_at: '2026-08-01T00:00:00Z' })]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('excludes an org suspended via orgs.platform_suspended_at', async () => {
    const admin = fakeAdmin([completeOrg('org-platform-suspended', { platform_suspended_at: '2026-08-01T00:00:00Z' })]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('excludes an org suspended only via the OLD matchdeal_profiles path (pre-migration data, defense in depth)', async () => {
    const admin = fakeAdmin(
      [completeOrg('org-legacy-suspended')],
      [{ membership_id: 'org-legacy-suspended', owner_suspended_at: '2026-07-01T00:00:00Z' }],
    );
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual([]);
  });

  it('includes a suspended-and-then-unsuspended org (both suspension timestamps null again)', async () => {
    const admin = fakeAdmin([completeOrg('org-back', { owner_suspended_at: null, platform_suspended_at: null })]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-back']);
  });

  it('accepts sectors_other in place of a taxonomy pick, same as isProfileGateComplete itself', async () => {
    const admin = fakeAdmin([completeOrg('org-other-sector', { sectors: [], sectors_other: 'Something niche' })]);
    expect(await eligiblePipelineOrgIds(admin, false)).toEqual(['org-other-sector']);
  });
});
