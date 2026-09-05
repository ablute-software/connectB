import { describe, expect, it } from 'vitest';
import { filterEligibleOrgs, type EligibilityOrg, type EligibilityStartupProfile } from './pipeline-eligibility';

// Prompt 556 §B. These REPLACE the rule Prompt 184's tests pinned
// (isProfileGateComplete alone) — see pipeline-eligibility.ts's header for
// why the reversal is deliberate and why Caramel Biscuit's original symptom
// is now the intended answer rather than the bug.
const open: EligibilityOrg = { id: 'org-open', closed_at: null, is_test: false };
const published: EligibilityStartupProfile = { membership_id: 'org-open', is_visible: true };

function run(orgs: EligibilityOrg[], profiles: EligibilityStartupProfile[], viewerIsTest = false) {
  return filterEligibleOrgs(orgs, profiles, viewerIsTest);
}

describe('filterEligibleOrgs', () => {
  it('includes a published, open, non-test org', () => {
    expect(run([open], [published])).toEqual(['org-open']);
  });

  // The exact case Nuno saw on his own About tab: "Investors can't find you
  // yet" while investors could. A complete CRM profile gate is no longer any
  // part of this decision — this function never even receives those fields.
  it('excludes an org whose startup profile is not published', () => {
    expect(run([open], [{ membership_id: 'org-open', is_visible: false }])).toEqual([]);
  });

  it('excludes an org with no startup MatchDeal profile at all — absent is not an implicit yes', () => {
    expect(run([open], [])).toEqual([]);
  });

  // Krohnsty 54f1bf67: published or not, a closed org never reaches discovery.
  it('excludes a closed org even when its profile still says published', () => {
    expect(run([{ ...open, closed_at: '2026-09-03T17:25:38Z' }], [published])).toEqual([]);
  });

  it('excludes a suspended org from either source', () => {
    expect(run([{ ...open, owner_suspended_at: '2026-09-01T00:00:00Z' }], [published])).toEqual([]);
    expect(run([{ ...open, platform_suspended_at: '2026-09-01T00:00:00Z' }], [published])).toEqual([]);
    expect(run([open], [{ ...published, owner_suspended_at: '2026-09-01T00:00:00Z' }])).toEqual([]);
    expect(run([open], [{ ...published, platform_suspended_at: '2026-09-01T00:00:00Z' }])).toEqual([]);
  });

  // Prompt 07/08 visibilidade simétrica, folded in from excludeTestOrgIds.
  it('hides a test org from a real viewer and shows it to a test viewer', () => {
    const testOrg: EligibilityOrg = { id: 'org-test', is_test: true };
    const testProfile: EligibilityStartupProfile = { membership_id: 'org-test', is_visible: true };
    expect(run([testOrg], [testProfile], false)).toEqual([]);
    expect(run([testOrg], [testProfile], true)).toEqual(['org-test']);
  });

  // A pre-0305/pre-0139 environment sends neither column at all. Absent must
  // read as "not closed" and "not test", never as a crash or an exclusion.
  it('treats absent closed_at / is_test as not closed and not test', () => {
    const bare: EligibilityOrg = { id: 'org-bare' };
    expect(run([bare], [{ membership_id: 'org-bare', is_visible: true }])).toEqual(['org-bare']);
  });

  it('keeps only the eligible ids out of a mixed set, in order', () => {
    const orgs: EligibilityOrg[] = [
      { id: 'a' }, { id: 'b', closed_at: '2026-09-03T00:00:00Z' }, { id: 'c' }, { id: 'd', is_test: true },
    ];
    const profiles: EligibilityStartupProfile[] = [
      { membership_id: 'a', is_visible: true }, { membership_id: 'b', is_visible: true },
      { membership_id: 'c', is_visible: false }, { membership_id: 'd', is_visible: true },
    ];
    expect(run(orgs, profiles)).toEqual(['a']);
  });

  // Prompt 563 — the platform inside its own marketplace.
  it('excludes an org with a discovery_excluded_reason, even for a test viewer', () => {
    const platform: EligibilityOrg = { id: 'org-platform', discovery_excluded_reason: 'is the platform itself' };
    const profiles = [{ membership_id: 'org-platform', is_visible: true }];
    // Both cohorts: unlike is_test, this exclusion has no viewer that escapes it.
    expect(filterEligibleOrgs([platform], profiles, false)).toEqual([]);
    expect(filterEligibleOrgs([platform], profiles, true)).toEqual([]);
  });

  it('excludes it even when the profile is published and everything else is healthy', () => {
    const platform: EligibilityOrg = {
      id: 'org-platform', closed_at: null, is_test: false,
      owner_suspended_at: null, platform_suspended_at: null,
      discovery_excluded_reason: 'is the platform itself',
    };
    expect(filterEligibleOrgs([platform], [{ membership_id: 'org-platform', is_visible: true }], false)).toEqual([]);
  });

  it('an empty string is not an exclusion — only a real reason excludes', () => {
    const org: EligibilityOrg = { id: 'org-a', discovery_excluded_reason: '' };
    expect(filterEligibleOrgs([org], [{ membership_id: 'org-a', is_visible: true }], false)).toEqual(['org-a']);
  });

  it('absent discovery_excluded_reason leaves a normal org listable', () => {
    const org: EligibilityOrg = { id: 'org-a' };
    expect(filterEligibleOrgs([org], [{ membership_id: 'org-a', is_visible: true }], false)).toEqual(['org-a']);
  });

  // Prompt 571 — moderation reaches the pipeline.
  it('excludes a suspended org, and a deleted one', () => {
    const profiles = [{ membership_id: 'org-a', is_visible: true }];
    for (const status of ['suspended', 'deleted']) {
      const org: EligibilityOrg = { id: 'org-a', moderation_status: status };
      expect(filterEligibleOrgs([org], profiles, false)).toEqual([]);
    }
  });

  it('undo needs no second step — back to active is back in the pipeline', () => {
    const org: EligibilityOrg = { id: 'org-a', moderation_status: 'active' };
    expect(filterEligibleOrgs([org], [{ membership_id: 'org-a', is_visible: true }], false)).toEqual(['org-a']);
  });

  it('absent moderation_status reads as active, like every other field here', () => {
    const org: EligibilityOrg = { id: 'org-a' };
    expect(filterEligibleOrgs([org], [{ membership_id: 'org-a', is_visible: true }], false)).toEqual(['org-a']);
  });
});
