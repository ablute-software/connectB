import { describe, expect, it } from 'vitest';
import { visiblePipelineSize, completeMonthsSince, isProfileGateComplete, hasAnyDocumentNamed, PLAN_PIPELINE_BASE, PLAN_PIPELINE_MONTHLY_ADDITION } from './pipeline-unlock';

const baseInput = {
  planTier: 'idea' as const,
  profileGateComplete: true,
  investorDeckUploaded: false,
  businessPlanUploaded: false,
  presetFoldersWithFile: 0,
  presetFolderCount: 22, // the doc's own worked examples assume 22 preset folders (§0.2) — production's real value (13, vault-preset-folders.ts's PRESET_FOLDER_COUNT) is passed by the caller, not hard-coded here.
  firstOutboundLogged: false,
  firstInboundLogged: false,
  firstManualAddLogged: false,
  completeMonthsSinceUnlock: 0,
  eligiblePoolSize: 999,
};

describe('visiblePipelineSize — per-term additive checks', () => {
  it('is 0 whenever the profile gate is not complete, regardless of every other input', () => {
    expect(visiblePipelineSize({ ...baseInput, profileGateComplete: false, investorDeckUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 5 })).toBe(0);
  });
  it('adds the deck bonus (+5)', () => {
    expect(visiblePipelineSize({ ...baseInput, investorDeckUploaded: true })).toBe(PLAN_PIPELINE_BASE.idea + 5);
  });
  it('adds the business plan bonus (+5)', () => {
    expect(visiblePipelineSize({ ...baseInput, businessPlanUploaded: true })).toBe(PLAN_PIPELINE_BASE.idea + 5);
  });
  it('adds 1 per preset folder with a file, capped at presetFolderCount', () => {
    expect(visiblePipelineSize({ ...baseInput, presetFoldersWithFile: 3 })).toBe(PLAN_PIPELINE_BASE.idea + 3);
    expect(visiblePipelineSize({ ...baseInput, presetFoldersWithFile: 999 })).toBe(PLAN_PIPELINE_BASE.idea + 22);
  });
  it('adds the three one-time milestone bonuses', () => {
    expect(visiblePipelineSize({ ...baseInput, firstOutboundLogged: true, firstInboundLogged: true, firstManualAddLogged: true }))
      .toBe(PLAN_PIPELINE_BASE.idea + 3);
  });
  it('adds monthly_addition × complete months since unlock', () => {
    expect(visiblePipelineSize({ ...baseInput, completeMonthsSinceUnlock: 3 })).toBe(PLAN_PIPELINE_BASE.idea + PLAN_PIPELINE_MONTHLY_ADDITION.idea * 3);
  });
  it('never exceeds the real eligible pool', () => {
    expect(visiblePipelineSize({ ...baseInput, completeMonthsSinceUnlock: 50, eligiblePoolSize: 12 })).toBe(12);
  });
});

// Prompt 123 / "Correção Cards Planos.md" — the plan's own literal worked
// examples for "Elementary, my dear" (base 5, monthly addition 10),
// encoded verbatim as regression tests. presetFolderCount is pinned to 22
// here specifically to reproduce the doc's own arithmetic (its examples
// were written against a hypothetical 22-folder preset — production's real
// preset is 13, see §0.2 / vault-preset-folders.ts).
//
// Examples G, H and I's TEXT only mentions "investor pitch" (the deck), but
// their stated totals (37/47/57) only reconcile with the formula if the
// business plan bonus is ALSO counted (5 + 5(deck) + 5(plan) + 22(folders)
// = 37, not 32) — the doc's own sentence is missing "e o business plan".
// Encoded here with businessPlanUploaded: true to match the stated NUMBERS,
// flagged rather than silently corrected in the doc's prose.
//
// Example F is NOT encoded as a test: "investor pitch + 1 file in Financial
// + 1 file in One-pager, no other files" claims a result of 22, but under
// every consistent reading of the formula that scenario computes to 12
// (5 base + 5 deck + 2 folders) — 22 is the preset FOLDER COUNT mentioned
// two sentences earlier in the same doc, which strongly suggests a
// copy-paste slip, not a formula disagreement. Flagged for Nuno rather than
// invented into a passing test.
describe('visiblePipelineSize — literal doc examples (Elementary, my dear)', () => {
  const elementary = { ...baseInput, planTier: 'idea' as const };

  it('Example B — complete profile, month 1, no vault files = 5', () => {
    expect(visiblePipelineSize({ ...elementary, completeMonthsSinceUnlock: 0 })).toBe(5);
  });
  it('Example C — complete profile, month 2, no vault files = 15', () => {
    expect(visiblePipelineSize({ ...elementary, completeMonthsSinceUnlock: 1 })).toBe(15);
  });
  it('Example D — complete profile, month 1, investor pitch only = 10', () => {
    expect(visiblePipelineSize({ ...elementary, investorDeckUploaded: true, completeMonthsSinceUnlock: 0 })).toBe(10);
  });
  it('Example E — complete profile, month 2, investor pitch only = 20', () => {
    expect(visiblePipelineSize({ ...elementary, investorDeckUploaded: true, completeMonthsSinceUnlock: 1 })).toBe(20);
  });
  it('Example G — month 1, deck + business plan + all 22 folders filled = 37', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 0,
    })).toBe(37);
  });
  it('Example H — month 2, deck + business plan + all 22 folders filled = 47', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 1,
    })).toBe(47);
  });
  it('Example I — month 3, deck + business plan + all 22 folders filled = 57', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 2,
    })).toBe(57);
  });
});

describe('completeMonthsSince', () => {
  it('is 0 for the same date', () => {
    expect(completeMonthsSince('2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(0);
  });
  it('counts a full calendar month once the day-of-month has passed', () => {
    expect(completeMonthsSince('2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z')).toBe(1);
    expect(completeMonthsSince('2026-01-15T00:00:00Z', '2026-03-16T00:00:00Z')).toBe(2);
  });
  it('does not count a partial month', () => {
    expect(completeMonthsSince('2026-01-15T00:00:00Z', '2026-02-10T00:00:00Z')).toBe(0);
  });
  it('never goes negative', () => {
    expect(completeMonthsSince('2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
  });
});

describe('hasAnyDocumentNamed', () => {
  it('matches case-insensitively on a substring', () => {
    expect(hasAnyDocumentNamed(['Q3 Business Plan.pdf'], ['business plan'])).toBe(true);
    expect(hasAnyDocumentNamed(['q3 business plan v2.pdf'], ['business plan'])).toBe(true);
  });
  it('is false with no matching document', () => {
    expect(hasAnyDocumentNamed(['Cap table.xlsx'], ['business plan', 'investor deck'])).toBe(false);
  });
  it('matches regardless of which folder the file sits in — no dedicated Business plan folder exists', () => {
    expect(hasAnyDocumentNamed(['Financials.pdf', 'Our Business Plan 2026.pdf'], ['business plan'])).toBe(true);
  });
});

describe('isProfileGateComplete', () => {
  const complete = {
    website: 'https://acme.co', sectors: ['fintech'], stage: 'seed', country: 'PT',
    round_target_eur: 500_000, current_phase: 'pilot', founded_year: 2024, revenue_eur: 0,
    primary_contact_person_id: 'person-1',
  };
  it('is true when every gate field is present', () => {
    expect(isProfileGateComplete(complete)).toBe(true);
  });
  it('accepts sectors_other in place of a taxonomy pick', () => {
    expect(isProfileGateComplete({ ...complete, sectors: [], sectors_other: 'Something else' })).toBe(true);
  });
  it('is false when any single required field is missing', () => {
    for (const key of Object.keys(complete)) {
      expect(isProfileGateComplete({ ...complete, [key]: key === 'sectors' ? [] : undefined })).toBe(false);
    }
  });
});
