import { describe, expect, it } from 'vitest';
import { filterEligibleOrgs, type EligibilityOrg, type EligibilityStartupProfile } from './pipeline-eligibility';

// Prompt 850 §A. These REPLACE the rule Prompt 556 §B's tests pinned
// (matchdeal_profiles.is_visible) — see pipeline-eligibility.ts's header for
// why that reversal is itself reversed, and why the founder's opt-out now
// lives in §B's always-available switch rather than in an act (Publish on
// MatchDeal) most founders never perform.
//
// The nine gate fields are spelled out once here, as a real complete org,
// rather than mocked: isProfileGateComplete is reused, not reimplemented, so
// a test that faked it would pin nothing.
const complete: EligibilityOrg = {
  id: 'org-open',
  closed_at: null,
  is_test: false,
  website: 'https://example.com',
  sectors: ['healthtech'],
  stage: 'seed',
  country: 'PT',
  round_target_eur: 1_300_000,
  current_phase: 'raising',
  founded_year: 2024,
  revenue_eur: 0,
  primary_contact_person_id: 'person-1',
};
const NOW = '2026-09-04T12:00:00Z';

function run(orgs: EligibilityOrg[], profiles: EligibilityStartupProfile[], viewerIsTest = false, now = NOW) {
  return filterEligibleOrgs(orgs, profiles, viewerIsTest, now);
}

describe('filterEligibleOrgs', () => {
  // The heart of Prompt 850: a complete account is a candidate whether or
  // not it ever opened MatchDeal. Both shapes the production data actually
  // has — an unpublished profile row (Sherlock Deal, Krohnsty 70a354f2) and
  // no profile row at all.
  it('includes a complete, open, non-test org with an unpublished profile row', () => {
    expect(run([complete], [{ membership_id: 'org-open' }])).toEqual(['org-open']);
  });

  it('includes a complete org with no matchdeal_profiles row at all', () => {
    expect(run([complete], [])).toEqual(['org-open']);
  });

  // The gate is the one thing that replaces is_visible, so every one of the
  // nine fields must be able to keep an org out on its own.
  it('excludes an org whose founder profile gate is incomplete', () => {
    expect(run([{ ...complete, website: null }], [])).toEqual([]);
    expect(run([{ ...complete, primary_contact_person_id: null }], [])).toEqual([]);
    expect(run([{ ...complete, sectors: [], sectors_other: null }], [])).toEqual([]);
    // "New company (please rename in Settings)" in production: an org row
    // exists, nothing has been filled in, and it must never be discovered.
    expect(run([{ id: 'org-empty' }], [])).toEqual([]);
  });

  // Krohnsty 54f1bf67: complete or not, a closed org never reaches discovery.
  // Prompt 556 §A, untouched by this prompt.
  it('excludes a closed org even when the gate is complete', () => {
    expect(run([{ ...complete, closed_at: '2026-09-03T17:25:38Z' }], [])).toEqual([]);
  });

  it('excludes a suspended org from either source', () => {
    expect(run([{ ...complete, owner_suspended_at: '2026-09-01T00:00:00Z' }], [])).toEqual([]);
    expect(run([{ ...complete, platform_suspended_at: '2026-09-01T00:00:00Z' }], [])).toEqual([]);
    expect(run([complete], [{ membership_id: 'org-open', owner_suspended_at: '2026-09-01T00:00:00Z' }])).toEqual([]);
    expect(run([complete], [{ membership_id: 'org-open', platform_suspended_at: '2026-09-01T00:00:00Z' }])).toEqual([]);
  });

  // Prompt 850 §A's own reason for existing. Estojo, live: back-office
  // suspended on 02/09 10:27 UTC, still admitted to a new investor's
  // pipeline on 04/09 09:03 because nothing in production called
  // isVisibleToOthers.
  describe('back-office moderation (the hole 850 §A closes)', () => {
    it('excludes an indefinitely suspended org', () => {
      expect(run([{ ...complete, moderation_status: 'suspended' }], [])).toEqual([]);
    });

    it('excludes a time-boxed suspended org while the clock is running', () => {
      expect(run([{ ...complete, moderation_status: 'suspended', moderation_suspended_until: '2026-09-05T00:00:00Z' }], [])).toEqual([]);
    });

    it('restores a time-boxed suspended org once its clock expires — no developer click needed', () => {
      expect(run([{ ...complete, moderation_status: 'suspended', moderation_suspended_until: '2026-09-04T09:00:00Z' }], [])).toEqual(['org-open']);
    });

    it('never restores a deleted org, time-box or not', () => {
      expect(run([{ ...complete, moderation_status: 'deleted' }], [])).toEqual([]);
      expect(run([{ ...complete, moderation_status: 'deleted', moderation_suspended_until: '2026-01-01T00:00:00Z' }], [])).toEqual([]);
    });

    it('treats an absent moderation_status as active — a pre-0121 environment has no state to honour', () => {
      expect(run([{ ...complete, moderation_status: undefined }], [])).toEqual(['org-open']);
      expect(run([{ ...complete, moderation_status: null }], [])).toEqual(['org-open']);
    });
  });

  // Prompt 07/08 visibilidade simétrica, folded in from excludeTestOrgIds.
  it('hides a test org from a real viewer and shows it to a test viewer', () => {
    const testOrg: EligibilityOrg = { ...complete, id: 'org-test', is_test: true };
    expect(run([testOrg], [], false)).toEqual([]);
    expect(run([testOrg], [], true)).toEqual(['org-test']);
  });

  // A pre-0305/pre-0139 environment sends neither column at all. Absent must
  // read as "not closed" and "not test", never as a crash or an exclusion.
  it('treats absent closed_at / is_test as not closed and not test', () => {
    const bare: EligibilityOrg = { ...complete, id: 'org-bare', closed_at: undefined, is_test: undefined };
    expect(run([bare], [])).toEqual(['org-bare']);
  });

  // is_visible is no longer read at all. This is the regression test for the
  // whole prompt: the exact production shape (five complete orgs, one
  // published) must now yield five, not one.
  it('ignores is_visible entirely — an unpublished but complete account is a candidate', () => {
    const orgs: EligibilityOrg[] = [
      { ...complete, id: 'ablute' },
      { ...complete, id: 'sherlock-deal' },
      { ...complete, id: 'krohnsty-70a354f2' },
      { ...complete, id: 'estojo', moderation_status: 'suspended' },
      { ...complete, id: 'krohnsty-54f1bf67', closed_at: '2026-09-03T17:25:38Z' },
      { id: 'new-company-please-rename' },
    ];
    expect(run(orgs, [{ membership_id: 'ablute' }])).toEqual(['ablute', 'sherlock-deal', 'krohnsty-70a354f2']);
  });

  it('keeps only the eligible ids out of a mixed set, in order', () => {
    const orgs: EligibilityOrg[] = [
      { ...complete, id: 'a' },
      { ...complete, id: 'b', closed_at: '2026-09-03T00:00:00Z' },
      { ...complete, id: 'c', country: null },
      { ...complete, id: 'd', is_test: true },
      { ...complete, id: 'e' },
    ];
    expect(run(orgs, [])).toEqual(['a', 'e']);
  });
});
