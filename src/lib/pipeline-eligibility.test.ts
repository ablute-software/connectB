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

  // A pre-0303/pre-0139 environment sends neither column at all. Absent must
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
});
