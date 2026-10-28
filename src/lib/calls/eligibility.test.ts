// Prompt 918 (I2) — the eligibility rules: what each kind may be tied to, how what the editor sent is read, the sentence with its boundary, what is wrong with a rule whose question changed, and the
// verdict of the objective rules on one answer (every boundary), plus the recipes prepared for the document rules.
import { describe, expect, it } from 'vitest';
import { DOC_TYPES, detectDocType, fold, maxAgeFromText, prepareRecipe, recipeLines } from './doc-recipe';
import { allowedKinds, earliestAllowed, evaluateObjective, parseRulesPayload, ruleProblems, ruleSentence, suggestClosedQuestion, type EligibilityRule } from './eligibility';
import { newField } from './form-builder';
import type { FormField } from './types';

const F = {
  sector: '10000000-0000-4000-8000-000000000001', raised: '10000000-0000-4000-8000-000000000002', founded: '10000000-0000-4000-8000-000000000003',
  seat: '10000000-0000-4000-8000-000000000004', cert: '10000000-0000-4000-8000-000000000005', name: '10000000-0000-4000-8000-000000000006', tax: '10000000-0000-4000-8000-000000000007',
  impact: '10000000-0000-4000-8000-000000000008', group: '10000000-0000-4000-8000-000000000009',
};
const fields = (): FormField[] => [
  { ...newField('single_choice', 1, 0), id: F.sector, label: 'Sector', options: [{ id: 'o-health', label: 'Health' }, { id: 'o-energy', label: 'Energy' }, { id: 'o-other', label: 'Other' }] },
  { ...newField('number', 1, 1), id: F.raised, label: 'Amount you are raising' },
  { ...newField('date', 1, 2), id: F.founded, label: 'Date of incorporation' },
  { ...newField('yes_no', 1, 3), id: F.seat, label: 'Is your head office in Portugal?' },
  { ...newField('file', 2, 0), id: F.cert, label: 'Permanent Certificate', instruction: 'Issued less than 3 months ago.' },
  { ...newField('short_text', 1, 4), id: F.name, label: 'Company name' },
  { ...newField('short_text', 1, 5), id: F.tax, label: 'Tax ID (NIF)' },
  { ...newField('long_text', 1, 6), id: F.impact, label: 'Does the project have a social impact?' },
  { ...newField('group', 1, 7), id: F.group, label: 'Team' },
];
const call = { opensAt: '2026-10-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', timezone: 'Europe/Lisbon' };
const ctx = { currency: 'EUR', call };
type Loose = { fieldId: string; kind: EligibilityRule['kind']; params: Record<string, unknown> };
const rule = (over: Loose & { id?: string; note?: string | null; position?: number }): EligibilityRule => ({ id: '20000000-0000-4000-8000-000000000001', note: null, position: 0, ...over } as EligibilityRule);

describe('which rules a question can have', () => {
  it('a choice takes options; a number, a number rule; a date, a date rule; yes/no, yes/no; a file, the four document rules; the rest only an open requirement', () => {
    expect(allowedKinds('single_choice')).toEqual(['options', 'open']);
    expect(allowedKinds('multiple_choice')).toEqual(['options', 'open']);
    expect(allowedKinds('number')).toEqual(['number', 'open']);
    expect(allowedKinds('date')).toEqual(['date', 'open']);
    expect(allowedKinds('yes_no')).toEqual(['yes_no', 'open']);
    expect(allowedKinds('file')).toEqual(['doc_present', 'doc_right', 'doc_valid', 'doc_authentic', 'open']);
    for (const k of ['short_text', 'long_text', 'email', 'url', 'group', 'table'] as const) expect(allowedKinds(k)).toEqual(['open']);
  });
});

describe('reading what the editor sent', () => {
  const ok = (rules: unknown[]) => parseRulesPayload(rules, fields());
  it('accepts a good rule of each kind, with ids and positions', () => {
    const r = ok([
      { fieldId: F.sector, kind: 'options', params: { accepted: ['o-health', 'o-energy'] } },
      { fieldId: F.raised, kind: 'number', params: { op: 'lte', value: '500000' } },
      { fieldId: F.founded, kind: 'date', params: { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' } },
      { fieldId: F.seat, kind: 'yes_no', params: { expected: 'yes' } },
      { fieldId: F.cert, kind: 'doc_valid', params: { maxAgeMonths: 3, matchName: F.name, matchTaxId: F.tax } },
      { fieldId: F.impact, kind: 'open', params: { text: 'Has a social impact' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules.map((x) => x.kind)).toEqual(['options', 'number', 'date', 'yes_no', 'doc_valid', 'open']);
    expect(r.rules.map((x) => x.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(r.rules.map((x) => x.id)).size).toBe(6);
    expect(r.rules[1].params).toEqual({ op: 'lte', value: 500000 });
  });
  it('refuses, with a sentence: a missing question, a kind the question cannot have, bad parameters, nothing to choose, everything accepted, a repeat', () => {
    const msg = (rules: unknown[]) => { const r = ok(rules); return r.ok ? null : r.error; };
    expect(msg([{ fieldId: 'nope', kind: 'yes_no', params: { expected: 'yes' } }])).toMatch(/choose a question or document/);
    expect(msg([{ fieldId: F.raised, kind: 'options', params: { accepted: ['x'] } }])).toMatch(/does not fit this question/);
    expect(msg([{ fieldId: F.sector, kind: 'options', params: { accepted: [] } }])).toMatch(/at least one accepted option/);
    expect(msg([{ fieldId: F.sector, kind: 'options', params: { accepted: ['o-health', 'o-energy', 'o-other'] } }])).toMatch(/would never exclude/);
    expect(msg([{ fieldId: F.raised, kind: 'number', params: { op: 'lte', value: 'lots' } }])).toMatch(/digits only/);
    expect(msg([{ fieldId: F.raised, kind: 'number', params: { op: 'between', value: 10, value2: 5 } }])).toMatch(/second not smaller/);
    expect(msg([{ fieldId: F.founded, kind: 'date', params: { op: 'within_last', amount: 0, unit: 'years' } }])).toMatch(/months or years/);
    expect(msg([{ fieldId: F.founded, kind: 'date', params: { op: 'on_or_after', date: '2026-02-30' } }])).toMatch(/give the date/);
    expect(msg([{ fieldId: F.seat, kind: 'yes_no', params: {} }])).toMatch(/which answer is eligible/);
    expect(msg([{ fieldId: F.impact, kind: 'open', params: { text: '  ' } }])).toMatch(/write the requirement/);
    const dup = { fieldId: F.seat, kind: 'yes_no', params: { expected: 'yes' } };
    expect(msg([dup, dup])).toMatch(/already a yes \/ no rule/);
    expect(msg('x' as never)).toMatch(/must be a list/);
    expect(msg(Array.from({ length: 61 }, () => ({})))).toMatch(/at most 60/);
  });
  it('a document comparison may only point at a question that exists; several open requirements are fine', () => {
    const r = ok([{ fieldId: F.cert, kind: 'doc_valid', params: { maxAgeMonths: null, matchName: 'ghost', matchTaxId: F.tax } }, { fieldId: F.impact, kind: 'open', params: { text: 'a' } }, { fieldId: F.impact, kind: 'open', params: { text: 'b' } }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rules[0].params).toEqual({ maxAgeMonths: null, matchName: null, matchTaxId: F.tax });
  });
});

describe('the sentence says the boundary', () => {
  const s = (r: Loose) => ruleSentence(rule(r), fields().find((f) => f.id === r.fieldId), ctx).replace(/[  ]/g, ' ');
  it('number: "exactly" is said in every operator', () => {
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'eq', value: 500000 } })).toBe('Applicants who state exactly 500 000 € in “Amount you are raising” are eligible.');
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'lte', value: 500000 } })).toContain('500 000 € or less');
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'lte', value: 500000 } })).toContain('exactly 500 000 € is eligible');
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'lt', value: 500000 } })).toContain('exactly 500 000 € is not eligible');
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'gt', value: 100 } })).toContain('more than 100 €');
    expect(s({ fieldId: F.raised, kind: 'number', params: { op: 'between', value: 100000, value2: 500000 } })).toContain('both included');
  });
  it('options, yes/no, date and the document rules', () => {
    expect(s({ fieldId: F.sector, kind: 'options', params: { accepted: ['o-health', 'o-energy'], mode: 'any' } })).toBe('Applicants who choose at least one of “Health” or “Energy” in “Sector” are eligible.');
    expect(s({ fieldId: F.seat, kind: 'yes_no', params: { expected: 'yes' } })).toBe('Applicants who answer “Yes” to “Is your head office in Portugal?” are eligible.');
    expect(s({ fieldId: F.founded, kind: 'date', params: { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' } }))
      .toBe('Applicants whose “Date of incorporation” is no more than 5 years before 01 Oct 2026 (the day the call opens) are eligible — exactly 5 years before is eligible.');
    expect(s({ fieldId: F.cert, kind: 'doc_present', params: {} })).toContain('must attach a document');
    expect(s({ fieldId: F.cert, kind: 'doc_valid', params: { maxAgeMonths: 3, matchName: F.name, matchTaxId: null } })).toContain('issued within the last 3 months, showing the same company name as declared');
    expect(s({ fieldId: F.cert, kind: 'doc_authentic', params: {} })).toContain('always checked by a person');
    expect(s({ fieldId: F.impact, kind: 'open', params: { text: 'Has social impact' } })).toContain('A person decides every application');
  });
});

describe('a rule whose question changed is broken, not deleted', () => {
  const p = (r: Loose) => ruleProblems(rule(r), fields(), call);
  it('names what is wrong', () => {
    expect(p({ fieldId: 'gone', kind: 'yes_no', params: { expected: 'yes' } })[0]).toMatch(/no longer exists/);
    expect(p({ fieldId: F.raised, kind: 'yes_no', params: { expected: 'yes' } })[0]).toMatch(/different kind of question/);
    expect(p({ fieldId: F.sector, kind: 'options', params: { accepted: ['o-gone'], mode: 'any' } }).length).toBeGreaterThan(0);
    expect(p({ fieldId: F.cert, kind: 'doc_valid', params: { maxAgeMonths: null, matchName: 'ghost', matchTaxId: null } })[0]).toMatch(/no longer exists/);
    expect(ruleProblems(rule({ fieldId: F.founded, kind: 'date', params: { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' } }), fields(), { ...call, opensAt: null })[0]).toMatch(/needs an opening date/);
    expect(p({ fieldId: F.seat, kind: 'yes_no', params: { expected: 'yes' } })).toEqual([]);
  });
});

describe('the verdict of an objective rule — every boundary', () => {
  const ev = (r: Loose, v: unknown, shown = true) => evaluateObjective(rule(r), fields().find((f) => f.id === r.fieldId)!, v as never, { ...ctx, shown }).outcome;
  it('number: ≤ €500,000 passes at exactly 500000 and fails at 500001; < fails at the boundary; between includes both ends', () => {
    const lte = { fieldId: F.raised, kind: 'number' as const, params: { op: 'lte', value: 500000 } };
    expect([ev(lte, '500000'), ev(lte, '500001'), ev(lte, '1')]).toEqual(['pass', 'fail', 'pass']);
    const lt = { fieldId: F.raised, kind: 'number' as const, params: { op: 'lt', value: 500000 } };
    expect([ev(lt, '499999'), ev(lt, '500000')]).toEqual(['pass', 'fail']);
    const gt = { fieldId: F.raised, kind: 'number' as const, params: { op: 'gt', value: 100 } };
    expect([ev(gt, '100'), ev(gt, '101')]).toEqual(['fail', 'pass']);
    const between = { fieldId: F.raised, kind: 'number' as const, params: { op: 'between', value: 100, value2: 200 } };
    expect([ev(between, '99'), ev(between, '100'), ev(between, '200'), ev(between, '201')]).toEqual(['fail', 'pass', 'pass', 'fail']);
    expect(ev({ fieldId: F.raised, kind: 'number', params: { op: 'eq', value: 5 } }, '5')).toBe('pass');
  });
  it('options: any / only; yes/no', () => {
    const any = { fieldId: F.sector, kind: 'options' as const, params: { accepted: ['o-health'], mode: 'any' } };
    expect([ev(any, 'o-health'), ev(any, 'o-energy'), ev(any, ['o-energy', 'o-health'])]).toEqual(['pass', 'fail', 'pass']);
    const only = { fieldId: F.sector, kind: 'options' as const, params: { accepted: ['o-health'], mode: 'only' } };
    expect([ev(only, ['o-health']), ev(only, ['o-energy', 'o-health'])]).toEqual(['pass', 'fail']);
    const yes = { fieldId: F.seat, kind: 'yes_no' as const, params: { expected: 'yes' } };
    expect([ev(yes, 'yes'), ev(yes, 'no')]).toEqual(['pass', 'fail']);
  });
  it('date: "within the last 5 years of the opening day" — the exact day five years before is eligible, the day before is not; 29 Feb', () => {
    const r = { fieldId: F.founded, kind: 'date' as const, params: { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' } };
    expect([ev(r, '2021-10-01'), ev(r, '2021-09-30'), ev(r, '2026-09-01'), ev(r, '2030-01-01')]).toEqual(['pass', 'fail', 'pass', 'pass']);
    expect(earliestAllowed('2028-02-29', 1, 'years')).toBe('2027-02-28');
    expect(earliestAllowed('2026-03-31', 1, 'months')).toBe('2026-02-28');
    expect([ev({ fieldId: F.founded, kind: 'date', params: { op: 'on_or_after', date: '2020-01-01' } }, '2020-01-01'), ev({ fieldId: F.founded, kind: 'date', params: { op: 'on_or_before', date: '2020-01-01' } }, '2020-01-02')]).toEqual(['pass', 'fail']);
  });
  it('the reference day is the call\'s own: 1 Oct 00:30 in Lisbon is still 1 Oct (not the 30th of September in UTC)', () => {
    const r = { fieldId: F.founded, kind: 'date' as const, params: { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' } };
    const early = evaluateObjective(rule(r), fields()[2], '2021-10-01', { currency: 'EUR', call: { ...call, opensAt: '2026-09-30T23:30:00.000Z' } });
    expect(early.outcome).toBe('pass');
  });
  it('no answer fails an objective rule; a question that was hidden goes to a person, never passes in silence; a document is "present" or not', () => {
    expect(ev({ fieldId: F.raised, kind: 'number', params: { op: 'lte', value: 5 } }, undefined)).toBe('fail');
    expect(ev({ fieldId: F.raised, kind: 'number', params: { op: 'lte', value: 5 } }, '1', false)).toBe('validate');
    expect([ev({ fieldId: F.cert, kind: 'doc_present', params: {} }, { fileName: 'a.pdf', size: 1 }), ev({ fieldId: F.cert, kind: 'doc_present', params: {} }, null)]).toEqual(['pass', 'fail']);
    expect(ev({ fieldId: F.impact, kind: 'open', params: { text: 'x' } }, 'yes')).toBe('validate');
  });
});

describe('an open requirement proposes a closed question', () => {
  it('a question stays a question; a statement becomes "Can you confirm…"', () => {
    expect(suggestClosedQuestion('Does the project have social impact?').label).toBe('Does the project have social impact?');
    expect(suggestClosedQuestion('The project has social impact.').label).toBe('Can you confirm the following? The project has social impact.');
    expect(suggestClosedQuestion('x').expected).toBe('yes');
  });
});

describe('the recipe is prepared from the entity\'s own words', () => {
  const cert = fields().find((f) => f.id === F.cert)!;
  it('recognises the document by what the entity wrote (Portuguese or English, accents or not) and reads its age from the text', () => {
    expect(detectDocType('Certidão Permanente de registo comercial')?.key).toBe('permanent_certificate');
    expect(detectDocType('Upload the permanent certificate')?.key).toBe('permanent_certificate');
    expect(detectDocType('Declaração de não dívida às Finanças')?.key).toBe('tax_clearance');
    expect(detectDocType('Segurança Social')?.key).toBe('social_security_clearance');
    expect(detectDocType('Informação Empresarial Simplificada (IES)')?.key).toBe('ies');
    expect(detectDocType('something about nothing')).toBeNull();
    expect(fold('Certidão')).toBe('certidao');
    expect([maxAgeFromText('emitida há menos de 3 meses'), maxAgeFromText('issued within the last 6 months'), maxAgeFromText('no more than 2 years'), maxAgeFromText('whatever')]).toEqual([3, 6, 24, null]);
  });
  it('a permanent certificate: other names, headings, issuer, what is read, the code and the official portal, the comparisons and the age', () => {
    const { recipe, sourceText } = prepareRecipe({ kind: 'doc_valid', params: { maxAgeMonths: null, matchName: F.name, matchTaxId: F.tax }, note: null }, cert, fields());
    expect(sourceText).toBe('Permanent Certificate · Issued less than 3 months ago.');
    expect(recipe).toMatchObject({ docType: 'permanent_certificate', maxAgeMonths: 3, accessCodePattern: expect.stringContaining('\\d{4}') });
    expect(recipe.extract).toEqual(expect.arrayContaining(['legal_name', 'tax_id', 'access_code']));
    expect(recipe.compare.map((c) => c.fieldId)).toEqual([F.name, F.tax]);
    expect(recipe.verification?.portalName).toBe('Portal da Empresa');
    const lines = recipeLines(recipe).join('\n');
    expect(lines).toContain('We look for: Permanent Certificate');
    expect(lines).toContain('within the last 3 months');
    expect(lines).toContain('Portal da Empresa');
  });
  it('a document it does not know is said plainly, never invented — a person validates every one', () => {
    const odd = { ...cert, label: 'Letter of intent', instruction: null };
    const { recipe } = prepareRecipe({ kind: 'doc_right', params: { docType: null }, note: null }, odd, fields());
    expect(recipe.docType).toBeNull();
    expect(recipe.notes[0]).toMatch(/a person will validate each one/);
  });
  it('the entity may choose the type itself; "present" reads nothing from the file', () => {
    expect(prepareRecipe({ kind: 'doc_right', params: { docType: 'cap_table' }, note: null }, { ...cert, label: 'Annex', instruction: null }, fields()).recipe.docType).toBe('cap_table');
    expect(prepareRecipe({ kind: 'doc_present', params: {}, note: null }, cert, fields()).recipe.extract).toEqual([]);
  });
  it('the dictionary is sane: keys unique, every detectable type has a label', () => {
    expect(new Set(DOC_TYPES.map((d) => d.key)).size).toBe(DOC_TYPES.length);
    for (const d of DOC_TYPES) expect(d.label.length).toBeGreaterThan(3);
  });
});
