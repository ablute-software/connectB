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
    // Prompt 181 — base(5)+22 folders(22)=27 used to pass through uncapped;
    // month 1's (base+bonuses) is now capped at PLAN_PIPELINE_MONTHLY_ADDITION.idea (10).
    expect(visiblePipelineSize({ ...baseInput, presetFoldersWithFile: 999 })).toBe(PLAN_PIPELINE_MONTHLY_ADDITION.idea);
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
// their stated totals (37/47/57) only reconciled with the formula if the
// business plan bonus was ALSO counted (5 + 5(deck) + 5(plan) + 22(folders)
// = 37, not 32) — the doc's own sentence was missing "e o business plan".
// Encoded here with businessPlanUploaded: true to match the stated NUMBERS,
// flagged rather than silently corrected in the doc's prose.
//
// Example F — confirmed by Nuno's own independent re-derivation (addenda_p123
// §2 D3, 2026-08-04): the doc's stated 22 was a copy-paste slip from the
// "22 preset folders" sentence two lines above; the formula genuinely
// produced 12 for this scenario before Prompt 181.
//
// Prompt 181 (12/08) SUPERSEDES F, G, H and I's totals below: month 1's
// (base + bonuses) is now capped at PLAN_PIPELINE_MONTHLY_ADDITION.idea (10)
// instead of summed without limit, closing the exact "31, not 10" bug the
// prompt named (5 base + every bonus maxed = 31 with production's real
// 13-folder preset). F (base 5 + bonus 7 = 12) and G/H/I (base 5 + every
// bonus maxed) all now hit that same 10 cap in month 1, then grow by
// +10/month from there — 20 in month 2, 30 in month 3 for G/H/I.
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
  it('Example F — month 1, investor pitch + 2 folders = 10 (Prompt 181: base 5 + bonus 7 = 12, capped at 10)', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, presetFoldersWithFile: 2, completeMonthsSinceUnlock: 0,
    })).toBe(10);
  });
  it('Example E — complete profile, month 2, investor pitch only = 20', () => {
    expect(visiblePipelineSize({ ...elementary, investorDeckUploaded: true, completeMonthsSinceUnlock: 1 })).toBe(20);
  });
  it('Example G — month 1, deck + business plan + all 22 folders filled = 10, not 37 (Prompt 181 cap)', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 0,
    })).toBe(10);
  });
  it('Example H — month 2, deck + business plan + all 22 folders filled = 20, not 47 (Prompt 181 cap)', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 1,
    })).toBe(20);
  });
  it('Example I — month 3, deck + business plan + all 22 folders filled = 30, not 57 (Prompt 181 cap)', () => {
    expect(visiblePipelineSize({
      ...elementary, investorDeckUploaded: true, businessPlanUploaded: true, presetFoldersWithFile: 22, completeMonthsSinceUnlock: 2,
    })).toBe(30);
  });
});

// Prompt 181 — the exact scenario the prompt's own "Disciplina de sempre"
// names: production's REAL 13-folder Vault preset (not the doc's
// hypothetical 22), every bonus earned. Confirms the "31, not 10" bug
// description verbatim (5 base + 26 bonus = 31 pre-181) and its fix (10),
// plus the month-2/month-3 worked table (20, 30) for all three tiers —
// cross-checked against the prompt's own numbers, which is how the
// deviation flagged above (capping base+bonus together, not bonus alone)
// was found: only this reconciles 10/25/50 and 20/50/100 and 30/75/150.
describe('visiblePipelineSize — Prompt 181 bonus cap, all three tiers, real 13-folder preset', () => {
  const allBonusesEarned = {
    profileGateComplete: true, investorDeckUploaded: true, businessPlanUploaded: true,
    presetFoldersWithFile: 13, presetFolderCount: 13,
    firstOutboundLogged: true, firstInboundLogged: true, firstManualAddLogged: true,
    eligiblePoolSize: 999,
  };
  it.each([
    ['idea', 10, 20, 30],
    ['garage', 25, 50, 75],
    ['motherfunding', 50, 100, 150],
  ] as const)('%s — month 1 caps at %d, month 2 at %d, month 3 at %d, never 31/35/76 uncapped', (planTier, m1, m2, m3) => {
    expect(visiblePipelineSize({ ...allBonusesEarned, planTier, completeMonthsSinceUnlock: 0 })).toBe(m1);
    expect(visiblePipelineSize({ ...allBonusesEarned, planTier, completeMonthsSinceUnlock: 1 })).toBe(m2);
    expect(visiblePipelineSize({ ...allBonusesEarned, planTier, completeMonthsSinceUnlock: 2 })).toBe(m3);
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
