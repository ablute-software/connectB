// Prompt 929 (B) — the internal engine of the tips: the weakest areas against the selected applications, linked to general categories by words (PT and EN), at most 3, no AI, nothing that reveals a score, a position
// or a criterion; nothing when there are not enough evaluations or no clear point; the same application always gets the same sentences; the model sentences are digit-free and complete in both languages.
import { describe, expect, it } from 'vitest';
import { CATEGORIES, SENTENCES } from './tips-templates';
import { MAX_TIPS, categoryOf, chooseTips, sentenceFor, type TipsInput } from './tips';

const crit = (id: string, name: string, weight = 20, guidance = '') => ({ id, name, guidance, weight });
const base = (over: Partial<TipsInput> = {}): TipsInput => ({
  language: 'en', applicationId: 'app-1', weighted: true, selectedCount: 3, submittedEvaluations: 3, missingOptionalDocuments: 0, shortAnswers: 0,
  criteria: [crit('t', 'Quality of the team'), crit('m', 'Market size and competition'), crit('p', 'Innovation of the solution'), crit('f', 'Financial plan'), crit('i', 'Social and environmental impact')],
  mine: { t: 80, m: 40, p: 45, f: 70, i: 30 }, selected: { t: 82, m: 75, p: 80, f: 72, i: 78 }, ...over,
});

describe('linking a criterion to a category, by its words', () => {
  it('finds the category in English and in Portuguese, ignoring accents and case', () => {
    expect(categoryOf({ name: 'Quality of the TEAM' })).toBe('team');
    expect(categoryOf({ name: 'Equipa e experiência dos fundadores' })).toBe('team');
    expect(categoryOf({ name: 'Dimensão do mercado e concorrência' })).toBe('market');
    expect(categoryOf({ name: 'Innovation', guidance: 'Is the technology new and feasible?' })).toBe('product');
    expect(categoryOf({ name: 'Business model and pricing' })).toBe('business_model');
    expect(categoryOf({ name: 'Impacto social e ambiental' })).toBe('impact');
    expect(categoryOf({ name: 'Plano financeiro e orçamento' })).toBe('finance');
  });
  it('a criterion that matches no category is not linked (and so is never used)', () => {
    expect(categoryOf({ name: 'Overall impression of the jury' })).toBeNull();
    expect(categoryOf({ name: 'Wildcard', guidance: 'whatever the panel thinks' })).toBeNull();
  });
});

describe('choosing the tips', () => {
  it('picks the weakest areas against the selected applications — at most 3, the furthest first — with a sentence each', () => {
    const r = chooseTips(base());
    expect(r.reason).toBe('ok');
    expect(r.categories).toEqual(['impact', 'market', 'product']);                         // gaps 48, 35, 35 (weighted): impact first; market before product on a tie by category order
    expect(r.sentences).toHaveLength(3);
    expect(MAX_TIPS).toBe(3);
    expect(r.sentences.every((s) => s.length > 20)).toBe(true);
  });
  it('the weight of a criterion counts when the call is weighted, and does not when every criterion counts the same', () => {
    const heavy = base({ criteria: [crit('t', 'Team', 5), crit('m', 'Market', 60), crit('p', 'Product', 5), crit('f', 'Finance', 5), crit('i', 'Impact', 5)], mine: { t: 50, m: 60, p: 40, f: 30, i: 20 }, selected: { t: 80, m: 80, p: 80, f: 80, i: 80 } });
    expect(chooseTips(heavy).categories[0]).toBe('market');
    expect(chooseTips({ ...heavy, weighted: false }).categories[0]).toBe('impact');
  });
  it('two criteria of the same category count once', () => {
    const r = chooseTips(base({ criteria: [crit('a', 'Market size'), crit('b', 'Customers and competition'), crit('c', 'Team')], mine: { a: 30, b: 20, c: 90 }, selected: { a: 80, b: 80, c: 90 } }));
    expect(r.categories).toEqual(['market']);
  });
  it('a gap that is small is not a clear point; a criterion that cannot be linked is not used', () => {
    expect(chooseTips(base({ mine: { t: 78, m: 72, p: 77, f: 70, i: 75 } })).reason).toBe('no_clear_points');
    expect(chooseTips(base({ criteria: [crit('x', 'Overall impression')], mine: { x: 10 }, selected: { x: 90 } })).reason).toBe('no_clear_points');
  });
  it('fewer than 2 submitted evaluations, or nobody selected to compare with: no tips at all', () => {
    expect(chooseTips(base({ submittedEvaluations: 1 }))).toEqual({ reason: 'not_enough_evaluations', categories: [], sentences: [] });
    expect(chooseTips(base({ selectedCount: 0 }))).toEqual({ reason: 'no_comparison', categories: [], sentences: [] });
  });
  it('what was missing in the form fills a free place with the documentation tip (lowest priority)', () => {
    const flat = base({ mine: { t: 80, m: 80, p: 80, f: 70, i: 75 } });
    expect(chooseTips({ ...flat, missingOptionalDocuments: 2 }).categories).toEqual(['documentation']);
    expect(chooseTips({ ...flat, shortAnswers: 4 }).categories).toEqual(['documentation']);
    expect(chooseTips({ ...flat, shortAnswers: 2 }).reason).toBe('no_clear_points');
    expect(chooseTips({ ...base(), missingOptionalDocuments: 1 }).categories).toHaveLength(3);          // three real points already: the form fills nothing
    expect(chooseTips({ ...base(), missingOptionalDocuments: 1 }).categories).not.toContain('documentation');
  });
  it('is deterministic: the same application always gets the same sentences, in the language of the call', () => {
    expect(chooseTips(base())).toEqual(chooseTips(base()));
    const pt = chooseTips(base({ language: 'pt' }));
    expect(pt.sentences[0]).toBe(sentenceFor(pt.categories[0], 'pt', 'app-1'));
    expect(pt.sentences[0]).not.toBe(chooseTips(base()).sentences[0]);
    expect(new Set(CATEGORIES.map((c) => sentenceFor(c, 'en', 'app-1'))).size).toBe(CATEGORIES.length);
  });
});

describe('the model sentences', () => {
  it('every category has 2 or 3 sentences in each language, and none carries a digit (so no score or number can leak through them)', () => {
    for (const cat of CATEGORIES) {
      for (const lang of ['en', 'pt'] as const) {
        const list = SENTENCES[cat][lang];
        expect(list.length, `${cat}/${lang}`).toBeGreaterThanOrEqual(2);
        expect(list.length, `${cat}/${lang}`).toBeLessThanOrEqual(3);
        for (const s of list) expect(/\d/.test(s), `${cat}/${lang}: ${s}`).toBe(false);
      }
    }
  });
});
