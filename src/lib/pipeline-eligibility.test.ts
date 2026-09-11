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
function run(orgs: EligibilityOrg[], profiles: EligibilityStartupProfile[], viewerIsTest = false) {
  return filterEligibleOrgs(orgs, profiles, viewerIsTest);
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

  // The hole 850 §A was written to close, closed by Prompt 571's check —
  // which landed on `main` from a parallel session while 850 was in flight.
  // Estojo, live: back-office suspended on 02/09 10:27 UTC, still admitted to
  // a new investor's pipeline on 04/09 09:03 because nothing in production
  // read orgs.moderation_status.
  describe('back-office moderation', () => {
    it('excludes a suspended org', () => {
      expect(run([{ ...complete, moderation_status: 'suspended' }], [])).toEqual([]);
    });

    it('never lets a deleted org back', () => {
      expect(run([{ ...complete, moderation_status: 'deleted' }], [])).toEqual([]);
    });

    // Nuno's decision, 07/09: 571's strict `!== 'active'` is kept over 850's
    // isVisibleToOthers, so a suspension lifts here ONLY on an explicit undo
    // — never on a time-box expiring, even though isLoginBlocked would have
    // let the same founder back in. This test is the record of that choice:
    // if it ever flips, this is the assertion that has to change.
    it('does NOT expire a time-boxed suspension on its own — only an undo lifts it', () => {
      const lapsed = { ...complete, moderation_status: 'suspended' } as EligibilityOrg;
      expect(run([lapsed], [])).toEqual([]);
      expect(run([{ ...complete, moderation_status: 'active' }], [])).toEqual(['org-open']);
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
  // Prompt 563 (merged from `main` while 850 was in flight) — the platform
  // inside its own marketplace. Unlike is_test, this exclusion has no viewer
  // that escapes it, and unlike the gate it is not something the founder can
  // finish their way out of.
  describe('discovery_excluded_reason (Prompt 563)', () => {
    it('excludes an excluded org for a real viewer AND a test viewer', () => {
      const platform: EligibilityOrg = { ...complete, id: 'org-platform', discovery_excluded_reason: 'is the platform itself' };
      expect(run([platform], [], false)).toEqual([]);
      expect(run([platform], [], true)).toEqual([]);
    });

    it('excludes it even when everything else about the account is healthy', () => {
      const platform: EligibilityOrg = {
        ...complete, id: 'org-platform', closed_at: null, is_test: false,
        owner_suspended_at: null, platform_suspended_at: null,
        moderation_status: 'active', discovery_excluded_reason: 'is the platform itself',
      };
      expect(run([platform], [{ membership_id: 'org-platform' }])).toEqual([]);
    });

    it('an empty string is not an exclusion — only a real reason excludes', () => {
      expect(run([{ ...complete, id: 'org-a', discovery_excluded_reason: '' }], [])).toEqual(['org-a']);
    });

    it('absent discovery_excluded_reason leaves a complete org listable', () => {
      expect(run([{ ...complete, id: 'org-a' }], [])).toEqual(['org-a']);
    });
  });

  // Prompt 571's own case, kept verbatim: undo needs no second step.
  it('undo needs no second step — back to active is back in the pipeline', () => {
    expect(run([{ ...complete, id: 'org-a', moderation_status: 'suspended' }], [])).toEqual([]);
    expect(run([{ ...complete, id: 'org-a', moderation_status: 'active' }], [])).toEqual(['org-a']);
  });
});

// Prompt 857 §B — Nuno's decision (11/09): a timed suspension lifts everywhere
// on expiry, matching the DB functions. Same four cases as the SQL fixture.
describe('filterEligibleOrgs — timed suspension expiry (Prompt 857 §B)', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');
  const susp = (over: Partial<EligibilityOrg>): EligibilityOrg => ({ ...complete, id: 'org-s', ...over });
  const only = (org: EligibilityOrg) => filterEligibleOrgs([org], [], false, NOW);

  it('an expired timed suspension is listable again', () => {
    expect(only(susp({ moderation_status: 'suspended', moderation_suspended_until: '2026-09-10T00:00:00Z' }))).toEqual(['org-s']);
  });
  it('a still-running timed suspension stays out', () => {
    expect(only(susp({ moderation_status: 'suspended', moderation_suspended_until: '2026-09-20T00:00:00Z' }))).toEqual([]);
  });
  it('an indefinite suspension (no clock) stays out', () => {
    expect(only(susp({ moderation_status: 'suspended', moderation_suspended_until: null }))).toEqual([]);
  });
  it('deleted stays out regardless of clock', () => {
    expect(only(susp({ moderation_status: 'deleted', moderation_suspended_until: '2026-09-10T00:00:00Z' }))).toEqual([]);
  });
  it('active is listable', () => {
    expect(only(susp({ moderation_status: 'active' }))).toEqual(['org-s']);
  });
});
