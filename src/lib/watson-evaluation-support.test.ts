import { describe, it, expect } from 'vitest';
import { buildEvaluationSupportPrompt, parseWatsonInsights, type EvaluationSupportInput } from './watson-evaluation-support';

const BASE: EvaluationSupportInput = {
  orgName: 'ablute_',
  visibleSummary: { oneLiner: 'Healthtech', stage: 'seed', sectors: ['healthtech'], roundTargetEur: 1_300_000 },
  scorecard: [], docScores: [],
};

describe('buildEvaluationSupportPrompt', () => {
  it('only ever mentions the org name, visible summary, and the investor\'s own data — never a second investor', () => {
    const prompt = buildEvaluationSupportPrompt({
      ...BASE,
      scorecard: [{ label: 'Team', weight: 2, score: 8, note: 'Strong founders' }],
    });
    expect(prompt).toContain('ablute_');
    expect(prompt).toContain('Team (weight 2): 8');
    expect(prompt).toContain('Strong founders');
    // Auditability: the prompt text is built ONLY from the input object's
    // own fields — there is no code path here that could pull in another
    // investor's row, since this function never touches the database.
  });

  it('omits the scorecard/docScores/watching sections entirely when empty, never an empty-but-present block', () => {
    const prompt = buildEvaluationSupportPrompt(BASE);
    expect(prompt).not.toContain('scorecard');
    expect(prompt).not.toContain('document ratings');
    expect(prompt).not.toContain('watching');
  });

  it('includes the watching delta when present, and says so plainly when nothing changed', () => {
    const withChanges = buildEvaluationSupportPrompt({ ...BASE, watching: { changedFieldLabels: ['Stage'], newClass1Statements: [], newClass2Statements: [] } });
    expect(withChanges).toContain('Stage changed');
    const noChanges = buildEvaluationSupportPrompt({ ...BASE, watching: { changedFieldLabels: [], newClass1Statements: [], newClass2Statements: [] } });
    expect(noChanges).toContain('Nothing has changed since your last visit.');
  });
});

describe('parseWatsonInsights', () => {
  it('accepts a well-formed insights array', () => {
    const out = parseWatsonInsights({ insights: [{ kind: 'reading', text: 'Team scored high, execution scored low.' }] });
    expect(out).toEqual([{ kind: 'reading', text: 'Team scored high, execution scored low.' }]);
  });

  it('drops entries with an invalid kind', () => {
    const out = parseWatsonInsights({ insights: [{ kind: 'not_a_real_kind', text: 'x' }] });
    expect(out).toEqual([]);
  });

  it('drops entries with a missing or non-string text', () => {
    const out = parseWatsonInsights({ insights: [{ kind: 'reading' }, { kind: 'reading', text: 42 }] });
    expect(out).toEqual([]);
  });

  it('caps at 3 insights even if the model returns more', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ kind: 'reading', text: `insight ${i}` }));
    expect(parseWatsonInsights({ insights: many })).toHaveLength(3);
  });

  it('handles a malformed/absent top-level shape without throwing', () => {
    expect(parseWatsonInsights(null)).toEqual([]);
    expect(parseWatsonInsights({})).toEqual([]);
    expect(parseWatsonInsights('not an object')).toEqual([]);
  });
});
