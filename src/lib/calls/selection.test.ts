// Prompt 925 — the selection proposal, in a pure module: the minimums (total and per criterion), the places without a budget, a fixed budget and the budget that each project asks for (an expensive project is skipped,
// the next that fits is taken, and the skip is flagged), the quotas (minimum and maximum together, a minimum that cannot be met, contradictory rules said at once), the tie-break chain and "Tie — decide".
import { describe, expect, it } from 'vitest';
import type { Criterion, Scoring } from './eval-grid';
import { DEFAULT_RULES, matchesQuota, minTotalText, minTotalUnit, parseRules, propose, ruleWarnings, sampleCandidates, unitToPosition, type Candidate, type Quota, type SelectionRules } from './selection';

const W: Scoring = { mode: 'weighted', aggregation: 'sum' };
const SUM: Scoring = { mode: 'equal', aggregation: 'sum' };
const crit = (id: string, name: string, min = 1, max = 5, extra: Partial<Criterion> = {}): Criterion => ({ id, section: null, position: 0, name, guidance: '', weight: 50, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore: null, ...extra });
const TEAM = crit('team', 'Team'); const TECH = crit('tech', 'Technology');
const CRITERIA = [TEAM, TECH];
const rules = (over: Partial<SelectionRules> = {}): SelectionRules => ({ ...DEFAULT_RULES, waitlist: 2, ...over });
const cand = (n: number, position: number | null, over: Partial<Candidate> = {}): Candidate => ({ applicationId: `a${n}`, reference: `R${n}`, startupName: `S${n}`, position, perCriterion: { team: 4, tech: 4 }, answers: {}, ...over });
const out = (p: ReturnType<typeof propose>, n: number) => p.items.find((i) => i.applicationId === `a${n}`)!;
const outcomes = (p: ReturnType<typeof propose>) => p.items.map((i) => `${i.applicationId}:${i.outcome}`).join(' ');
const sector = (v: string): Candidate['answers'] => ({ sector: v });
const Q = (id: string, optionId: string, over: Partial<Quota> = {}): Quota => ({ id, fieldId: 'sector', label: optionId === 'health' ? 'Health' : optionId === 'energy' ? 'Energy' : optionId, match: { kind: 'option', optionId }, minSeats: null, maxSeats: null, ...over });

describe('who takes part, and the minimums', () => {
  it('only evaluated applications take part: the others are "not considered" and get no proposal', () => {
    const p = propose({ rules: rules({ slots: 2 }), criteria: CRITERIA, scoring: W, candidates: [cand(1, 90), cand(2, null), cand(3, 80)] });
    expect(out(p, 2)).toMatchObject({ outcome: 'not_considered', rank: null, explanation: 'Not considered: the evaluation is not complete.' });
    expect(outcomes(p)).toBe('a1:selected a2:not_considered a3:selected');
    expect(p.summary).toMatchObject({ selected: 2, notConsidered: 1 });
  });
  it('the minimum of the total (in the unit of the call) sends whoever is below it to Reject, with the reason', () => {
    const p = propose({ rules: rules({ minTotal: 60, slots: 5 }), criteria: CRITERIA, scoring: W, candidates: [cand(1, 80), cand(2, 59.5), cand(3, 60)] });
    expect(out(p, 2)).toMatchObject({ outcome: 'reject', rank: null, explanation: 'Rejected: below the minimum score (59.5 % < 60 %).' });
    expect(out(p, 3).outcome).toBe('selected');                                              // exactly on the minimum passes
  });
  it('the minimum of the total in points: 18 / 30 is the same position as 60 %', () => {
    const six = Array.from({ length: 6 }, (_, i) => crit(`k${i}`, `K${i}`, 0, 5));
    expect(unitToPosition(18, six, SUM)).toBe(60);
    expect(minTotalText(18, six, SUM)).toBe('18 / 30 points');
    expect(minTotalUnit(six, SUM)).toEqual({ unit: 'points', max: 30 });
    expect(minTotalUnit(six, W)).toEqual({ unit: 'percent', max: 100 });
    const p = propose({ rules: rules({ minTotal: 18, slots: 3 }), criteria: six, scoring: SUM, candidates: [cand(1, 70, { perCriterion: {} }), cand(2, 55, { perCriterion: {} })] });
    expect(out(p, 2).explanation).toBe('Rejected: below the minimum score (16.5 / 30 points < 18 / 30 points).');
  });
  it('a minimum per criterion, and the eliminatory minimum of the grid counts as one', () => {
    const grid = [crit('team', 'Team', 1, 5, { minScore: 3 }), TECH];
    const p = propose({ rules: rules({ minPerCriterion: [{ criterionId: 'tech', min: 3 }], slots: 5 }), criteria: grid, scoring: W, candidates: [
      cand(1, 90), cand(2, 85, { perCriterion: { team: 2, tech: 4 } }), cand(3, 80, { perCriterion: { team: 4, tech: 2.5 } })] });
    expect(out(p, 2).explanation).toBe('Rejected: below the Team minimum (2 < 3).');
    expect(out(p, 3).explanation).toBe('Rejected: below the Technology minimum (2.5 < 3).');
    expect(out(p, 1).outcome).toBe('selected');
  });
});

describe('the places', () => {
  const six = [90, 85, 80, 75, 70, 65, 60].map((x, i) => cand(i + 1, x));
  it('without a budget: the first N are selected, the next ones wait, the rest are rejected — each says why', () => {
    const p = propose({ rules: rules({ slots: 2, waitlist: 2 }), criteria: CRITERIA, scoring: W, candidates: six });
    expect(outcomes(p)).toBe('a1:selected a2:selected a3:waitlist a4:waitlist a5:reject a6:reject a7:reject');
    expect(out(p, 1).explanation).toBe('Selected: 1st place.');
    expect(out(p, 3).explanation).toBe('Waitlist: 3rd place, slots full.');
    expect(out(p, 5).explanation).toBe('Rejected: 5th place, not within the available places.');
    expect(p.summary).toMatchObject({ selected: 2, waitlist: 2, rejected: 3, places: 2 });
  });
  it('no places and no budget: everybody above the minimum is selected', () => {
    const p = propose({ rules: rules({ minTotal: 65 }), criteria: CRITERIA, scoring: W, candidates: six });
    expect(p.summary).toMatchObject({ selected: 6, rejected: 1 });
  });
  it('the waiting list has the size that was asked for (and none when it is 0)', () => {
    const none = propose({ rules: rules({ slots: 1, waitlist: 0 }), criteria: CRITERIA, scoring: W, candidates: six });
    expect(none.summary).toMatchObject({ selected: 1, waitlist: 0, rejected: 6 });
  });
});

describe('the budget', () => {
  const asked = (n: number, position: number, amount: number) => cand(n, position, { answers: { ask: String(amount) } });
  it('a fixed amount per project: the budget runs out before the places do, and the rest say "budget reached"', () => {
    const p = propose({ rules: rules({ slots: 5, budget: { total: 300000, per: 'fixed', fixedAmount: 150000, fieldId: null } }), criteria: CRITERIA, scoring: W, candidates: [1, 2, 3].map((n) => cand(n, 100 - n)) });
    expect(outcomes(p)).toBe('a1:selected a2:selected a3:waitlist');
    expect(out(p, 3).explanation).toBe('Waitlist: 3rd place, budget reached (needs 150000, 0 left).');
    expect(p.summary).toMatchObject({ budgetUsed: 300000, budgetLeft: 0 });
    expect(out(p, 1).amount).toBe(150000);
  });
  it('the amount each project asks for: an expensive project is skipped, the next that fits is taken, and the skip is flagged', () => {
    const p = propose({ rules: rules({ slots: 3, waitlist: 3, budget: { total: 500000, per: 'asked', fixedAmount: null, fieldId: 'ask' } }), criteria: CRITERIA, scoring: W,
      candidates: [asked(1, 90, 300000), asked(2, 85, 400000), asked(3, 80, 150000), asked(4, 75, 100000)] });
    expect(outcomes(p)).toBe('a1:selected a2:waitlist a3:selected a4:waitlist');
    expect(out(p, 2)).toMatchObject({ budgetSkipped: true });
    expect(out(p, 2).explanation).toContain('budget reached (needs 400000, 200000 left); a lower-ranked project that fits the budget was selected instead');
    expect(out(p, 4).budgetSkipped).toBe(false);                                            // 4th place, nothing below it was taken
    expect(p.summary.skipped).toEqual(['a2']);
    expect(p.summary).toMatchObject({ budgetUsed: 450000, budgetLeft: 50000 });
  });
  it('a project that asked for no amount cannot be funded, and says so', () => {
    const p = propose({ rules: rules({ slots: 2, budget: { total: 500000, per: 'asked', fixedAmount: null, fieldId: 'ask' } }), criteria: CRITERIA, scoring: W, candidates: [cand(1, 90), asked(2, 80, 100000)] });
    expect(out(p, 1).explanation).toContain('no amount asked');
    expect(out(p, 2).outcome).toBe('selected');
  });
  it('places and budget together: whichever limit is reached first counts', () => {
    const c = [1, 2, 3, 4].map((n) => cand(n, 100 - n));
    expect(propose({ rules: rules({ slots: 2, budget: { total: 1000000, per: 'fixed', fixedAmount: 100000, fieldId: null } }), criteria: CRITERIA, scoring: W, candidates: c }).summary.selected).toBe(2);
    expect(propose({ rules: rules({ slots: 4, budget: { total: 250000, per: 'fixed', fixedAmount: 100000, fieldId: null } }), criteria: CRITERIA, scoring: W, candidates: c }).summary.selected).toBe(2);
  });
});

describe('the quotas', () => {
  const field = [cand(1, 95, { answers: sector('energy') }), cand(2, 90, { answers: sector('energy') }), cand(3, 85, { answers: sector('energy') }), cand(4, 70, { answers: sector('health') }), cand(5, 65, { answers: sector('health') })];
  it('a minimum fills the places with the best of that category, even below better projects of another', () => {
    const p = propose({ rules: rules({ slots: 3, quotas: [Q('h', 'health', { minSeats: 1 })] }), criteria: CRITERIA, scoring: W, candidates: field });
    expect(outcomes(p)).toBe('a1:selected a2:selected a3:waitlist a4:selected a5:waitlist');
    expect(out(p, 4).explanation).toBe('Selected: 4th place, Health quota.');
    expect(p.summary.quotas).toEqual([{ quotaId: 'h', label: 'Health', selected: 1, minSeats: 1, maxSeats: null, met: true }]);
  });
  it('a maximum stops a category from taking more, and the places go to the next', () => {
    const p = propose({ rules: rules({ slots: 3, quotas: [Q('e', 'energy', { maxSeats: 1 })] }), criteria: CRITERIA, scoring: W, candidates: field });
    expect(outcomes(p)).toBe('a1:selected a2:waitlist a3:waitlist a4:selected a5:selected');
    expect(out(p, 2).explanation).toBe('Waitlist: 2nd place, Energy quota full.');
  });
  it('a minimum and a maximum of different quotas work together', () => {
    const p = propose({ rules: rules({ slots: 3, quotas: [Q('h', 'health', { minSeats: 2 }), Q('e', 'energy', { maxSeats: 1 })] }), criteria: CRITERIA, scoring: W, candidates: field });
    expect(outcomes(p)).toBe('a1:selected a2:waitlist a3:waitlist a4:selected a5:selected');
    expect(p.summary.quotas.every((q) => q.met)).toBe(true);
  });
  it('a minimum that cannot be met (not enough projects of that category): the places go back to the general list, and the summary says it is not met', () => {
    const p = propose({ rules: rules({ slots: 3, quotas: [Q('h', 'health', { minSeats: 3 })] }), criteria: CRITERIA, scoring: W, candidates: field });
    expect(p.summary.selected).toBe(3);
    expect(outcomes(p)).toBe('a1:selected a2:waitlist a3:waitlist a4:selected a5:selected'.replace('a1:selected a2:waitlist', 'a1:selected a2:waitlist'));
    expect(p.summary.quotas[0]).toMatchObject({ selected: 2, minSeats: 3, met: false });
  });
  it('a quota on Yes/No, on a choice with several answers, and on a range of an amount', () => {
    const yes: Quota = { id: 'y', fieldId: 'impact', label: 'Impact', match: { kind: 'yes' }, minSeats: 1, maxSeats: null };
    const multi: Quota = { id: 'm', fieldId: 'areas', label: 'Rural', match: { kind: 'option', optionId: 'rural' }, minSeats: 1, maxSeats: null };
    const range: Quota = { id: 'r', fieldId: 'turnover', label: 'Small', match: { kind: 'range', min: null, max: 100000 }, minSeats: 1, maxSeats: null };
    expect(matchesQuota(yes, { impact: 'yes' })).toBe(true); expect(matchesQuota(yes, { impact: 'no' })).toBe(false); expect(matchesQuota(yes, {})).toBe(false);
    expect(matchesQuota(multi, { areas: ['urban', 'rural'] } as never)).toBe(true); expect(matchesQuota(multi, { areas: ['urban'] } as never)).toBe(false);
    expect(matchesQuota(range, { turnover: '99999' })).toBe(true); expect(matchesQuota(range, { turnover: '100001' })).toBe(false); expect(matchesQuota(range, { turnover: 'abc' })).toBe(false);
  });
  it('contradictory rules are said at once', () => {
    const w = ruleWarnings(rules({ slots: 3, quotas: [Q('h', 'health', { minSeats: 2, maxSeats: 1 }), Q('e', 'energy', { minSeats: 2 })], minTotal: 150, budget: { total: 100000, per: 'fixed', fixedAmount: 150000, fieldId: null }, minPerCriterion: [{ criterionId: 'team', min: 9 }] }), CRITERIA, W);
    expect(w).toEqual(expect.arrayContaining([
      'The minimum places of the quotas add up to 4, more than the 3 places.',
      'Quota “Health”: the minimum (2) is above its maximum (1).',
      'The amount per project is more than the whole budget: no project can be selected.',
      'The minimum score (150) is above the maximum possible (100): nobody can pass it.',
      'The minimum for “Team” (9) is above its maximum score (5): nobody can pass it.',
    ]));
    expect(ruleWarnings(rules({ slots: 4, budget: { total: 300000, per: 'fixed', fixedAmount: 100000, fieldId: null } }), CRITERIA, W)).toEqual(['The budget pays for 3 projects, fewer than the 4 places: the budget will be the first limit.']);
    expect(ruleWarnings(rules(), CRITERIA, W)).toEqual([]);
  });
});

describe('the tie-break chain', () => {
  it('breaks a tie by a criterion, then by another, and never by order of arrival', () => {
    const tied = [cand(1, 80, { perCriterion: { team: 3, tech: 5 } }), cand(2, 80, { perCriterion: { team: 4, tech: 2 } }), cand(3, 80, { perCriterion: { team: 4, tech: 4 } })];
    const p = propose({ rules: rules({ slots: 1, tieBreak: [{ kind: 'criterion', criterionId: 'team' }, { kind: 'criterion', criterionId: 'tech' }] }), criteria: CRITERIA, scoring: W, candidates: tied });
    expect(out(p, 3).outcome).toBe('selected');                                              // Team 4 = 4, then Technology 4 > 2
    expect(p.summary.ties).toEqual([]);
    const reversed = propose({ rules: rules({ slots: 1, tieBreak: [{ kind: 'criterion', criterionId: 'team' }, { kind: 'criterion', criterionId: 'tech' }] }), criteria: CRITERIA, scoring: W, candidates: [...tied].reverse() });
    expect(reversed.items.find((i) => i.outcome === 'selected')!.applicationId).toBe('a3');
  });
  it('a tie that matters and that the chain cannot break is "Tie — decide"; one that does not matter is left alone', () => {
    const p = propose({ rules: rules({ slots: 1, tieBreak: [{ kind: 'criterion', criterionId: 'team' }, { kind: 'manual' }] }), criteria: CRITERIA, scoring: W, candidates: [cand(1, 80), cand(2, 80), cand(3, 50)] });
    expect(p.summary.ties.sort()).toEqual(['a1', 'a2']);
    expect(out(p, 1).tie).toBe(true);
    expect(out(p, 1).explanation).toMatch(/^Tie — decide: 1st place, tied with 1 other/);
    const harmless = propose({ rules: rules({ slots: 2, tieBreak: [{ kind: 'manual' }] }), criteria: CRITERIA, scoring: W, candidates: [cand(1, 80), cand(2, 80), cand(3, 50)] });
    expect(harmless.summary.ties).toEqual([]);                                              // both are selected anyway
  });
  it('the people\'s own order resolves it, whatever order the applications arrive in', () => {
    const c = [cand(1, 80), cand(2, 80)];
    const resolved = propose({ rules: rules({ slots: 1, tieBreak: [{ kind: 'manual' }] }), criteria: CRITERIA, scoring: W, candidates: c, manualOrder: ['a2', 'a1'] });
    expect(resolved.summary.ties).toEqual([]);
    expect(out(resolved, 2).outcome).toBe('selected'); expect(out(resolved, 1).outcome).toBe('waitlist');
    expect(propose({ rules: rules({ slots: 1, tieBreak: [{ kind: 'manual' }] }), criteria: CRITERIA, scoring: W, candidates: [...c].reverse(), manualOrder: ['a2', 'a1'] }).items.find((i) => i.outcome === 'selected')!.applicationId).toBe('a2');
  });
  it('the same inputs always give the same proposal', () => {
    const c = [cand(1, 80), cand(2, 80), cand(3, 79)];
    const a = propose({ rules: rules({ slots: 1 }), criteria: CRITERIA, scoring: W, candidates: c });
    const b = propose({ rules: rules({ slots: 1 }), criteria: CRITERIA, scoring: W, candidates: [...c].reverse() });
    expect(a.items.map((i) => [i.applicationId, i.outcome]).sort()).toEqual(b.items.map((i) => [i.applicationId, i.outcome]).sort());
  });
});

describe('reading the rules the editor sends', () => {
  const ctx = { criteria: CRITERIA, fields: [
    { id: 'sector', kind: 'single_choice' as const, label: 'Sector', options: [{ id: 'health', label: 'Health' }, { id: 'energy', label: 'Energy' }] },
    { id: 'ask', kind: 'number' as const, label: 'Amount asked', options: [] }, { id: 'name', kind: 'short_text' as const, label: 'Name', options: [] },
  ] };
  it('accepts valid rules and brings them into shape', () => {
    const r = parseRules({ minTotal: '60', slots: 10, waitlist: 5, budget: { total: 1500000, per: 'fixed', fixedAmount: 150000 }, minPerCriterion: [{ criterionId: 'team', min: 3 }], quotas: [{ fieldId: 'sector', match: { kind: 'option', optionId: 'health' }, minSeats: 2 }], tieBreak: [{ kind: 'criterion', criterionId: 'team' }, { kind: 'manual' }] }, ctx);
    expect(r).toMatchObject({ ok: true, rules: { minTotal: 60, slots: 10, waitlist: 5, budget: { total: 1500000, per: 'fixed', fixedAmount: 150000 }, quotas: [{ id: 'q1', label: 'Health', minSeats: 2, maxSeats: null }] } });
  });
  it('refuses what points at nothing: an unknown criterion, an open question, an option that does not exist, an amount question that is not a number', () => {
    expect(parseRules({ minPerCriterion: [{ criterionId: 'nope', min: 1 }] }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ quotas: [{ fieldId: 'name', match: {}, minSeats: 1 }] }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ quotas: [{ fieldId: 'sector', match: { kind: 'option', optionId: 'zzz' }, minSeats: 1 }] }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ quotas: [{ fieldId: 'sector', match: { kind: 'option', optionId: 'health' } }] }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ budget: { total: 1000, per: 'asked', fieldId: 'name' } }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ budget: { total: 0, per: 'fixed', fixedAmount: 1 } }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ slots: 'ten' }, ctx)).toMatchObject({ ok: false });
    expect(parseRules({ minTotal: -1 }, ctx)).toMatchObject({ ok: false });
    expect(parseRules(null, ctx)).toMatchObject({ ok: false });
  });
  it('nothing means the defaults: no minimum, no limit, a waiting list of 5, a person decides ties', () => {
    expect(parseRules({}, ctx)).toMatchObject({ ok: true, rules: { minTotal: null, slots: null, budget: null, waitlist: 5, quotas: [], tieBreak: [] } });
  });
  it('the preview invents applications that exercise the quotas and the budget', () => {
    const r = parseRules({ slots: 4, budget: { total: 500000, per: 'asked', fieldId: 'ask' }, quotas: [{ fieldId: 'sector', match: { kind: 'option', optionId: 'health' }, minSeats: 1 }] }, ctx);
    if (!r.ok) throw new Error(r.error);
    const sample = sampleCandidates(r.rules, CRITERIA, ctx.fields);
    expect(sample).toHaveLength(12);
    const p = propose({ rules: r.rules, criteria: CRITERIA, scoring: W, candidates: sample });
    expect(p.summary.selected).toBeGreaterThan(0);
    expect(p.summary.quotas[0].selected).toBeGreaterThanOrEqual(1);
  });
});
