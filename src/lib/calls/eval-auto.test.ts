// Prompt 922 (Adenda 1, B) — a criterion that scores itself from a closed answer, and the links between criteria and the questions of the form: every kind of question, an incomplete table, a missing answer, the
// override with and without permission, the recalculation before submitting and the warning after, and the exclusion from the divergence.
import { describe, expect, it } from 'vitest';
import { autoDrift, autoPoints, autoProblems, autoResultsFor, blankAuto, liveScores, overrideMove, parseAuto, rangeText, resolveScore, type AutoScore } from './eval-auto';
import { computeBoard, type BoardInput } from './eval-board';
import { gridProblems, parseCriteriaPayload, type Criterion } from './eval-grid';
import { byPage, criteriaByField, linkableFields, suggestLinks } from './eval-links';
import { relinkToForm } from './eval-grid-store';
import type { FormField } from './types';

const S = { scaleMin: 1, scaleMax: 5 };
const F = (id: string, kind: FormField['kind'], label: string, options: string[] = [], page = 1, position = 0): FormField => ({
  id, page, position, kind, label, instruction: null, required: false, options: options.map((o, i) => ({ id: `${id}-o${i}`, label: o })), validations: {}, condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null,
});
const STAGE = F('stage', 'single_choice', 'Stage', ['Pre-seed', 'Seed', 'Series A']);
const TECH = F('tech', 'multiple_choice', 'Technologies', ['AI', 'Hardware', 'Biotech']);
const GRANT = F('grant', 'yes_no', 'Received a grant?');
const RAISED = F('raised', 'number', 'Investment received');
const PITCH = F('pitch', 'long_text', 'Pitch');

const withPoints = (f: FormField, patch: Partial<AutoScore>): AutoScore => ({ ...blankAuto(f), ...patch });

describe('single choice', () => {
  const auto = withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': 5 } });
  it('each option is worth what the table says, and the answer that gave it is named', () => {
    expect(autoPoints(auto, STAGE, 'stage-o0', S)).toEqual({ status: 'scored', points: 1, because: 'Pre-seed' });
    expect(autoPoints(auto, STAGE, 'stage-o1', S)).toMatchObject({ points: 3, because: 'Seed' });
    expect(autoPoints(auto, STAGE, 'stage-o2', S)).toMatchObject({ points: 5 });
  });
  it('no answer, or an answer with no points, needs a manual score', () => {
    expect(autoPoints(auto, STAGE, undefined, S)).toMatchObject({ status: 'missing' });
    expect(autoPoints(auto, STAGE, '', S)).toMatchObject({ status: 'missing' });
    expect(autoPoints(withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': null, 'stage-o2': 5 } }), STAGE, 'stage-o1', S)).toMatchObject({ status: 'missing' });
  });
});

describe('multiple choice', () => {
  const sum = withPoints(TECH, { options: { 'tech-o0': 2, 'tech-o1': 2, 'tech-o2': 3 }, multi: 'sum' });
  it('adds the points of the options chosen, never above the scale', () => {
    expect(autoPoints(sum, TECH, ['tech-o0'], S)).toMatchObject({ points: 2, because: 'AI' });
    expect(autoPoints(sum, TECH, ['tech-o0', 'tech-o1'], S)).toMatchObject({ points: 4 });
    expect(autoPoints(sum, TECH, ['tech-o0', 'tech-o1', 'tech-o2'], S)).toMatchObject({ points: 5, because: 'AI, Hardware, Biotech' });           // 7 → the scale's 5
  });
  it('or takes the highest', () => {
    expect(autoPoints({ ...sum, multi: 'max' }, TECH, ['tech-o0', 'tech-o2'], S)).toMatchObject({ points: 3 });
  });
  it('nothing chosen needs a manual score', () => {
    expect(autoPoints(sum, TECH, [], S)).toMatchObject({ status: 'missing' });
    expect(autoPoints(sum, TECH, undefined, S)).toMatchObject({ status: 'missing' });
  });
});

describe('Yes/No', () => {
  const auto = withPoints(GRANT, { yes: 5, no: 1 });
  it('Yes and No are worth their points; no answer is manual', () => {
    expect(autoPoints(auto, GRANT, 'yes', S)).toMatchObject({ points: 5, because: 'Yes' });
    expect(autoPoints(auto, GRANT, 'no', S)).toMatchObject({ points: 1, because: 'No' });
    expect(autoPoints(auto, GRANT, undefined, S)).toMatchObject({ status: 'missing' });
  });
});

describe('number or amount', () => {
  const auto = withPoints(RAISED, { ranges: [{ upTo: 50000, points: 1 }, { upTo: 250000, points: 3 }, { upTo: null, points: 5 }] });
  it('a value falls in exactly one range — the edges belong to the lower one, the last range has no limit', () => {
    expect(autoPoints(auto, RAISED, '0', S)).toMatchObject({ points: 1 });
    expect(autoPoints(auto, RAISED, '50000', S)).toMatchObject({ points: 1 });
    expect(autoPoints(auto, RAISED, '50001', S)).toMatchObject({ points: 3 });
    expect(autoPoints(auto, RAISED, '250000', S)).toMatchObject({ points: 3 });
    expect(autoPoints(auto, RAISED, '250001', S)).toMatchObject({ points: 5 });
    expect(autoPoints(auto, RAISED, '99999999', S)).toMatchObject({ points: 5 });
  });
  it('no number, or text, needs a manual score; the ranges read out as the editor shows them', () => {
    expect(autoPoints(auto, RAISED, '', S)).toMatchObject({ status: 'missing' });
    expect(autoPoints(auto, RAISED, 'a lot', S)).toMatchObject({ status: 'missing' });
    expect([0, 1, 2].map((i) => rangeText(auto.ranges, i))).toEqual(['up to 50 000', 'over 50 000 and up to 250 000', 'over 250 000']);
  });
});

describe('the table must be complete before the call can be validated, and is saved while it is built', () => {
  it('an option without points, Yes/No without one of them, a range without points or a last range with a limit — each said in words', () => {
    expect(autoProblems(withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': null, 'stage-o2': null } }), STAGE, 'Stage')).toEqual(['“Stage”: give points to the answer “Seed”.', '“Stage”: give points to the answer “Series A”.']);
    expect(autoProblems(withPoints(GRANT, { yes: 5 }), GRANT, 'Grant')).toEqual(['“Grant”: give points to “No”.']);
    expect(autoProblems(withPoints(RAISED, { ranges: [{ upTo: 100, points: null }, { upTo: null, points: 3 }] }), RAISED, 'Raised')).toEqual(['“Raised”: give points to up to 100.']);
    expect(autoProblems(withPoints(RAISED, { ranges: [{ upTo: 100, points: 1 }, { upTo: 200, points: 3 }] }), RAISED, 'Raised')).toEqual(['“Raised”: the last range must have no limit, so that every value is covered.']);
    expect(autoProblems(withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': 5 } }), STAGE, 'Stage')).toEqual([]);
  });
  it('the call is not ready while a table is incomplete, and a link to a question that left the form is a problem too', () => {
    const c: Criterion = { id: 'c1', section: null, position: 0, name: 'Stage', guidance: '', weight: 100, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null, linkedFields: ['stage'], auto: withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': null, 'stage-o2': 5 } }) };
    expect(gridProblems([c], [STAGE])).toEqual(['“Stage”: give points to the answer “Seed”.']);
    expect(gridProblems([{ ...c, auto: null, linkedFields: ['gone'] }], [STAGE])).toEqual(['“Stage” is linked to a question that is no longer in the form.']);
    expect(gridProblems([c])).toEqual([]);                                 // without the form at hand (a template), nothing to check against
  });
  it('what the editor sends is read strictly: points inside the scale and whole, options of the question, limits that grow, a kind that can score', () => {
    const ok = parseAuto({ options: { 'stage-o0': 1, 'stage-o1': '3' }, override: true }, STAGE, S, 'Stage');
    expect(ok).toMatchObject({ ok: false });                               // '3' as text is not a whole number: the editor sends numbers
    expect(parseAuto({ options: { 'stage-o0': 1, 'stage-o1': 3 }, override: true }, STAGE, S, 'Stage')).toMatchObject({ ok: true, auto: { override: true, options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': null } } });
    expect(parseAuto({ options: { 'stage-o0': 6 } }, STAGE, S, 'Stage')).toMatchObject({ ok: false, error: expect.stringContaining('from 1 to 5') });
    expect(parseAuto({ options: { 'stage-o0': 1.5 } }, STAGE, S, 'Stage')).toMatchObject({ ok: false });
    expect(parseAuto({ options: { stranger: 1 } }, STAGE, S, 'Stage')).toMatchObject({ ok: false, error: expect.stringContaining('not an option') });
    expect(parseAuto({ ranges: [{ upTo: 100, points: 1 }, { upTo: 50, points: 2 }] }, RAISED, S, 'Raised')).toMatchObject({ ok: false, error: expect.stringContaining('must grow') });
    expect(parseAuto({ ranges: [{ upTo: null, points: 1 }, { upTo: 50, points: 2 }] }, RAISED, S, 'Raised')).toMatchObject({ ok: false, error: expect.stringContaining('only the last') });
    expect(parseAuto({}, PITCH, S, 'Pitch')).toMatchObject({ ok: false, error: expect.stringContaining('cannot score') });
    expect(parseAuto({}, undefined, S, 'Gone')).toMatchObject({ ok: false, error: expect.stringContaining('not in the form') });
    expect(parseAuto({ ranges: [{ upTo: 100, points: null }] }, RAISED, S, 'Raised')).toMatchObject({ ok: true });       // saved while built
  });
});

describe('what an evaluation holds for an automatic criterion', () => {
  const auto = withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': 5 }, override: false });
  const seed = autoPoints(auto, STAGE, 'stage-o1', S);
  it('by default the evaluator cannot change it; with the permission they can, and the automatic value stays beside theirs', () => {
    expect(overrideMove(auto, seed)).toBe('locked');
    expect(overrideMove({ ...auto, override: true }, seed)).toBe('override');
    expect(overrideMove(auto, autoPoints(auto, STAGE, undefined, S))).toBe('manual');          // no answer: scored by hand
    expect(overrideMove(null, null)).toBe('manual');
    expect(resolveScore({ ...auto, override: true }, seed, { score: 4, comment: 'Better than it looks', source: 'override' })).toEqual({ score: 4, comment: 'Better than it looks', source: 'override', autoValue: 3 });
    expect(resolveScore(auto, seed, { score: 4, comment: '', source: 'override' })).toMatchObject({ score: 3, source: 'auto' });       // the permission was withdrawn: the point of the answer
  });
  it('while it is not submitted a corrected answer recalculates the point; an override stays until the answer says the same', () => {
    const held = { c1: { score: 3, comment: '', source: 'auto' as const, autoValue: 3 } };
    const now = autoPoints(auto, STAGE, 'stage-o2', S);
    expect(liveScores([{ id: 'c1', auto }], held, { c1: now }).c1).toMatchObject({ score: 5, source: 'auto', autoValue: 5 });
    expect(resolveScore({ ...auto, override: true }, now, { score: 2, comment: 'x', source: 'override', autoValue: 3 })).toMatchObject({ score: 2, source: 'override', autoValue: 5 });
    expect(resolveScore({ ...auto, override: true }, now, { score: 5, comment: 'x', source: 'override', autoValue: 3 })).toMatchObject({ score: 5, source: 'auto' });
  });
  it('no answer: the evaluator\'s own score counts, and the automatic one does not linger', () => {
    const none = autoPoints(auto, STAGE, undefined, S);
    expect(resolveScore(auto, none, { score: 4, comment: '', source: 'manual' })).toMatchObject({ score: 4, source: 'manual' });
    expect(resolveScore(auto, none, { score: 3, comment: '', source: 'auto', autoValue: 3 })).toMatchObject({ score: null, source: 'manual' });
  });
  it('after submitting nothing recalculates — an application that now says otherwise is only a warning for the administrator', () => {
    const held = { c1: { score: 3, comment: '', source: 'auto' as const, autoValue: 3 }, c2: { score: 2, comment: '', source: 'manual' as const } };
    const results = { c1: autoPoints(auto, STAGE, 'stage-o2', S) };
    expect(autoDrift([{ id: 'c1', name: 'Stage', auto }, { id: 'c2', name: 'Pitch' }], held, results)).toEqual([{ criterionId: 'c1', name: 'Stage', held: 3, now: 5 }]);
    expect(autoDrift([{ id: 'c1', name: 'Stage', auto }], held, { c1: seed })).toEqual([]);
  });
  it('the results for a whole grid are read from the answers of the application', () => {
    const crit = [{ id: 'c1', scaleMin: 1, scaleMax: 5, auto }, { id: 'c2', scaleMin: 1, scaleMax: 5 }];
    expect(autoResultsFor(crit, [STAGE], { stage: 'stage-o0' })).toEqual({ c1: { status: 'scored', points: 1, because: 'Pre-seed' } });
  });
});

describe('automatic criteria and the divergence', () => {
  const auto = withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': 5 } });
  const crit = (id: string, withAuto: boolean): Criterion => ({ id, section: null, position: 0, name: id, guidance: '', weight: 50, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null, linkedFields: [], auto: withAuto ? auto : null });
  const input = (evals: BoardInput['evaluations']): BoardInput => ({
    apps: [{ applicationId: 'a1', reference: 'R1', startupName: null }], evaluations: evals, assignments: [{ applicationId: 'a1', userId: 'u1' }, { applicationId: 'a1', userId: 'u2' }],
    criteriaByVersion: { 1: [crit('auto', true), crit('hand', false)] }, currentVersion: 1, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, decisions: {},
  });
  const ev = (u: string, hand: number, over: Partial<BoardInput['evaluations'][number]> = {}): BoardInput['evaluations'][number] => ({
    applicationId: 'a1', evaluatorUserId: u, status: 'submitted', gridVersion: 1, gradePercent: 50, scores: { auto: 3, hand }, sources: { auto: 'auto', hand: 'manual' }, autoValues: { auto: 3 }, ...over,
  });
  it('two evaluators who disagree on the hand-scored criterion are flagged; the automatic one never is', () => {
    const r = computeBoard(input([ev('u1', 1), ev('u2', 5)])).rows[0];
    expect(r.divergence.map((d) => d.name)).toEqual(['hand', 'Total']);
    expect(r.autoCriteria).toEqual(['auto']);
  });
  it('an override is shown with the automatic value beside the chosen one, and does not make a divergence of its own', () => {
    const r = computeBoard(input([ev('u1', 3), ev('u2', 3, { scores: { auto: 5, hand: 3 }, sources: { auto: 'override', hand: 'manual' } })])).rows[0];
    expect(r.overrides).toEqual([{ criterionId: 'auto', name: 'auto', auto: 3, chosen: 5, evaluators: 1 }]);
    expect(r.divergence.map((d) => d.name)).not.toContain('auto');
  });
  it('the total is compared on the criteria the evaluators scored by hand (the automatic ones are the same for all)', () => {
    // the grades given (stored) differ by 25 points only because of the override on the automatic criterion: that is not a divergence of the evaluators
    const r = computeBoard(input([ev('u1', 3, { gradePercent: 50 }), ev('u2', 3, { gradePercent: 75 })])).rows[0];
    expect(r.divergence).toEqual([]);
  });
});

describe('the questions of the form, numbered by page, and what each criterion is linked to', () => {
  const fields = [F('b', 'short_text', 'Team', [], 2, 0), F('a', 'long_text', 'Pitch', [], 1, 1), F('c', 'yes_no', 'Grant?', [], 1, 0), F('d', 'file', 'Deck', [], 2, 1)];
  it('numbered in the order the applicant meets them, grouped by page, with what each can do', () => {
    const l = linkableFields(fields);
    expect(l.map((x) => `${x.number}.${x.label}`)).toEqual(['1.Grant?', '2.Pitch', '3.Team', '4.Deck']);
    expect(byPage(l).map((p) => [p.page, p.fields.length])).toEqual([[1, 2], [2, 2]]);
    expect(l.map((x) => x.canScore)).toEqual([true, false, false, false]);
  });
  it('each question knows its criteria, so the panel shows what is left unevaluated', () => {
    const m = criteriaByField([{ id: 'k1', name: 'Team', linkedFields: ['b', 'd'] }, { id: 'k2', name: 'Fit', linkedFields: ['b'] }]);
    expect(m.get('b')?.map((x) => x.name)).toEqual(['Team', 'Fit']);
    expect(m.get('a')).toBeUndefined();
  });
  it('a link is read against the form of THIS call: a question that is not there refuses the save; a table of points of a link comes with it', () => {
    const f = [STAGE, PITCH];
    const bad = parseCriteriaPayload([{ name: 'X', weight: 10, scaleMin: 1, scaleMax: 5, linkedFields: ['nope'] }], { fields: f });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('no longer in the form') });
    const ok = parseCriteriaPayload([{ name: 'Stage', weight: 10, scaleMin: 1, scaleMax: 5, linkedFields: ['pitch'], auto: { fieldId: 'stage', options: { 'stage-o0': 1 } } }], { fields: f });
    expect(ok.ok && ok.criteria[0]).toMatchObject({ linkedFields: ['stage', 'pitch'], auto: { fieldId: 'stage', kind: 'single_choice' }, linkNotice: false });
  });
  it('the proposals read from a document: only when the text clearly points to ONE question', () => {
    const q = linkableFields([F('team', 'long_text', 'Describe your team and its experience'), F('mkt', 'long_text', 'Market size and growth'), F('fin', 'long_text', 'Financial projections for the next three years')]);
    expect(suggestLinks('Team and experience', q)).toEqual(['team']);
    expect(suggestLinks('Market size', q)).toEqual(['mkt']);
    expect(suggestLinks('Overall impression', q)).toEqual([]);
    expect(suggestLinks('Growth', q)).toEqual([]);                      // one word that is only part of a question: not clear
  });
});

describe('a template used in another call, and a duplicated call', () => {
  const crit: Criterion = { id: 'c1', section: null, position: 0, name: 'Stage', guidance: '', weight: 100, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null, linkedFields: ['stage'], auto: withPoints(STAGE, { options: { 'stage-o0': 1, 'stage-o1': 3, 'stage-o2': 5 } }) };
  it('in a call whose form has the same question the links stay; in one that does not they are empty and the criterion asks to be linked', () => {
    expect(relinkToForm([crit], [STAGE, PITCH])[0]).toMatchObject({ linkedFields: ['stage'], linkNotice: false, auto: { fieldId: 'stage' } });
    const other = relinkToForm([crit], [PITCH])[0];
    expect(other).toMatchObject({ linkedFields: [], auto: null, linkNotice: true });
    expect(relinkToForm([{ ...crit, linkedFields: [], auto: null }], [PITCH])[0].linkNotice).toBe(false);          // it never had a link: nothing to warn about
  });
  it('a table of points that no longer fits the question is dropped with the notice', () => {
    const changed = F('stage', 'single_choice', 'Stage', ['Idea', 'Seed']);
    expect(relinkToForm([crit], [changed])[0]).toMatchObject({ linkedFields: ['stage'], linkNotice: true });
  });
});
