// Prompt 542 §2 — the promises the rebalanced bar makes, pinned.
//
// The org shapes below are not invented: each is the real field-by-field
// state of that production org, read out of Supabase on 2026-09-02, so the
// "did a real profile drop?" question is answered against real profiles
// rather than a fixture that happens to be convenient.
import { describe, it, expect } from 'vitest';
import {
  COMPLETENESS_FIELDS, EMPTY_EVIDENCE, SIGNUP_FILLED_FIELD_IDS,
  calcCompanyCompleteness, type CompletenessEvidence,
} from './companyCompleteness';
import type { CompanyPerson, Org } from './types';

const ROUND_ONLY = ['round.stage', 'round.target', 'round.instruments', 'round.use_of_funds', 'round.target_close_date', 'round.runway'];
const TOTAL = COMPLETENESS_FIELDS.reduce((s, f) => s + f.weight, 0);

function person(over: Partial<CompanyPerson> = {}): CompanyPerson {
  return { id: 'p1', org_id: 'o1', full_name: 'Nuno', is_founder: true, ...over } as CompanyPerson;
}

// Every org field the formula reads, all filled.
const FULL_ORG = {
  legal_name: 'X, Lda', name: 'X', website: 'x.com', country: 'Portugal', hq_city: 'Porto',
  founded_year: 2026, sectors: ['SaaS'], one_liner: 'One line.', description: 'Desc.',
  intro_problem: 'P', intro_solution: 'S', logo_url: 'l.png', postal_code: '4900',
  current_phase: 'prototype', revenue_eur: 0, employee_count: 2,
  primary_contact_person_id: 'p1', round_raising: true, stage: 'pre_seed',
  round_target_eur: 400000, round_instruments: ['safe'], round_use_of_funds: 'Product.',
  round_target_close_date: '2026-12-31', round_runway_months: 12,
} as unknown as Org;

function evidence(over: Partial<CompletenessEvidence> = {}): CompletenessEvidence {
  return { documents: [], capTableRows: 0, tractionRows: 0, ...over };
}
const DECK = { name: 'deck.pdf', folderName: 'Investor deck' };
const PLAN = { name: 'plan.pdf', folderName: 'Business plan' };
const OTHER = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}.pdf`, folderName: null }));

function pct(org: Partial<Org>, people: CompanyPerson[], ev: CompletenessEvidence) {
  return calcCompanyCompleteness(org as Org, people, ev).pct;
}

describe('a fresh signup is no longer most of the way to done', () => {
  // Exactly what /api/provision-org writes, plus the four fields Prompt 539
  // adds (sectors, and the founder's own company_people row).
  const signupOrg = {
    name: 'Sherlock Deal', website: 'sherlockdeal.com', country: 'Portugal',
    sectors: ['SaaS'], one_liner: 'From pitch to close.',
    stage: 'pre_seed', round_target_eur: 400000, primary_contact_person_id: 'p1',
  } as unknown as Org;

  it('scores at most 8% with nothing but the registration form filled in', () => {
    // It was 34% before this rebalance, and would have been 55% once 539
    // lands — measured, not estimated.
    expect(pct(signupOrg, [person()], EMPTY_EVIDENCE)).toBeLessThanOrEqual(8);
  });

  it('scores 0% for an org where even registration collected nothing', () => {
    expect(pct({ name: '' } as Org, [], EMPTY_EVIDENCE)).toBe(0);
  });

  it('keeps the signup-filled list and the scored fields in agreement', () => {
    // Guards the arithmetic above from drifting: if a field is added to one
    // side and not the other, the ≤8% promise quietly stops meaning what it
    // says.
    for (const id of SIGNUP_FILLED_FIELD_IDS) {
      expect(COMPLETENESS_FIELDS.some((f) => f.id === id)).toBe(true);
    }
    const signupWeight = COMPLETENESS_FIELDS
      .filter((f) => (SIGNUP_FILLED_FIELD_IDS as readonly string[]).includes(f.id))
      .reduce((s, f) => s + f.weight, 0);
    expect(signupWeight / TOTAL).toBeLessThanOrEqual(0.08);
  });
});

describe('70% means real evidence exists', () => {
  it('is unreachable without a deck, however complete the profile', () => {
    const best = pct(FULL_ORG, [person()], evidence({ capTableRows: 8, tractionRows: 4, documents: [PLAN, ...OTHER(9)] }));
    expect(best).toBeLessThan(70);
  });

  it('is unreachable without either a cap table or traction', () => {
    const best = pct(FULL_ORG, [person()], evidence({ documents: [DECK, PLAN, ...OTHER(9)] }));
    expect(best).toBeLessThan(70);
  });

  it('is reachable with a deck plus either one of them', () => {
    expect(pct(FULL_ORG, [person()], evidence({ documents: [DECK], capTableRows: 1 }))).toBeGreaterThanOrEqual(70);
    expect(pct(FULL_ORG, [person()], evidence({ documents: [DECK], tractionRows: 1 }))).toBeGreaterThanOrEqual(70);
  });

  it('recognises a deck by the folder it sits in, not only its filename', () => {
    // Prompt 536 §4's own case: Krohnsty's "03_Krohnsty_Investment_Deck.pdf"
    // in the preset "Investor deck" folder.
    const byFolder = evidence({ documents: [{ name: '03_Krohnsty_Investment_Deck.pdf', folderName: 'Investor deck' }], capTableRows: 1 });
    expect(pct(FULL_ORG, [person()], byFolder)).toBeGreaterThanOrEqual(70);
  });
});

describe('real production profiles, before and after', () => {
  // ablute_: everything except use_of_funds; deck, business plans, 67 docs,
  // 8 cap table rows, 1 traction metric.
  it('does not penalise ablute_, which has done the work', () => {
    const org = { ...FULL_ORG, round_use_of_funds: null } as unknown as Org;
    const ev = evidence({ documents: [DECK, PLAN, ...OTHER(65)], capTableRows: 8, tractionRows: 1 });
    expect(pct(org, [person(), person({ id: 'p2' }), person({ id: 'p3' })], ev)).toBeGreaterThanOrEqual(95);
  });

  // Krohnsty: full profile, deck + cap table, but no traction and no
  // business plan. Constraint (d): a real profile with deck + cap table
  // must not drop by more than a few points from its old 100%.
  it('costs a deck + cap table profile only a few points', () => {
    const ev = evidence({ documents: [DECK, ...OTHER(2)], capTableRows: 1 });
    expect(pct(FULL_ORG, [person()], ev)).toBeGreaterThanOrEqual(93);
  });

  // Sherlock Deal on the day of Nuno's screenshot: a full profile, a cap
  // table, and ZERO documents. This is the case the whole change exists
  // for — the bar must not read as nearly finished.
  it('is honest about a profile with nothing in the Vault', () => {
    const ev = evidence({ capTableRows: 4 });
    const p = pct({ ...FULL_ORG, round_runway_months: null } as unknown as Org, [person()], ev);
    expect(p).toBeLessThan(70);
    expect(p).toBeGreaterThan(40); // the profile work still counts for something
  });
});

describe('the shape of the formula', () => {
  it('drops round-only fields when the founder is not raising', () => {
    const notRaising = { ...FULL_ORG, round_raising: false } as unknown as Org;
    const applicable = COMPLETENESS_FIELDS.filter((f) => !ROUND_ONLY.includes(f.id));
    expect(calcCompanyCompleteness(notRaising, [person()], evidence({ documents: [DECK], capTableRows: 1 })).missing
      .every((f) => applicable.some((a) => a.id === f.id))).toBe(true);
  });

  it('still gates 70% on a deck when not raising', () => {
    const notRaising = { ...FULL_ORG, round_raising: false } as unknown as Org;
    expect(pct(notRaising, [person()], evidence({ capTableRows: 8, tractionRows: 4, documents: OTHER(9) }))).toBeLessThan(70);
  });

  it('treats a missing evidence field as a link away, not a dead scroll target', () => {
    const missing = calcCompanyCompleteness(FULL_ORG, [person()], EMPTY_EVIDENCE).missing;
    for (const f of missing.filter((x) => x.card === 'vault')) expect(f.href).toBeTruthy();
    for (const f of missing.filter((x) => x.card !== 'vault')) expect(f.href).toBeUndefined();
  });

  it('defaults to no evidence rather than throwing when a caller omits it', () => {
    expect(() => calcCompanyCompleteness(FULL_ORG, [person()])).not.toThrow();
  });
});
