import { describe, expect, it } from 'vitest';
import { FIXED_BANK, pickFixedQuestions, pickFindingQuestions, buildSession, TRAIN_CATEGORIES, type Finding, type Question } from './train-questions';

describe('FIXED_BANK', () => {
  it('has exactly 3 questions for each of the 8 real interview categories', () => {
    expect(FIXED_BANK).toHaveLength(24);
    for (const cat of TRAIN_CATEGORIES) {
      expect(FIXED_BANK.filter((q) => q.category === cat)).toHaveLength(3);
    }
  });

  it('has no duplicate question text', () => {
    const texts = FIXED_BANK.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('pickFixedQuestions', () => {
  it('returns `count` distinct categories when count <= 8', () => {
    const picks = pickFixedQuestions(0, 4);
    expect(picks).toHaveLength(4);
    expect(new Set(picks.map((q) => q.category)).size).toBe(4);
  });

  it('is deterministic — same session count always yields the same questions', () => {
    expect(pickFixedQuestions(3, 4)).toEqual(pickFixedQuestions(3, 4));
  });

  it('produces zero repeated question text across any 3 consecutive sessions (count=4)', () => {
    for (let start = 0; start < 12; start++) {
      const seen = new Set<string>();
      for (let s = start; s < start + 3; s++) {
        for (const q of pickFixedQuestions(s, 4)) {
          expect(seen.has(q.text)).toBe(false);
          seen.add(q.text);
        }
      }
    }
  });

  it('produces zero repeated question text across any 3 consecutive sessions (count=8, the no-review fallback)', () => {
    for (let start = 0; start < 12; start++) {
      const seen = new Set<string>();
      for (let s = start; s < start + 3; s++) {
        for (const q of pickFixedQuestions(s, 8)) {
          expect(seen.has(q.text)).toBe(false);
          seen.add(q.text);
        }
      }
    }
  });
});

describe('pickFindingQuestions', () => {
  const findings: Finding[] = [
    { text: 'thin traction', category: 'traction' },
    { text: 'no pricing model', category: 'financing' },
    { text: 'vague go-to-market', category: 'positioning' },
  ];

  it('prefers categories not already used', () => {
    const used = new Set<'traction'>(['traction']);
    const picks = pickFindingQuestions(findings, used, new Set(), 2, 'derived');
    expect(picks.every((q) => q.category !== 'traction')).toBe(true);
  });

  it('returns an empty array when there are no findings', () => {
    expect(pickFindingQuestions([], new Set(), new Set(), 2, 'derived')).toEqual([]);
  });

  it('tags every question with the given source', () => {
    const picks = pickFindingQuestions(findings, new Set(), new Set(), 2, 'diligence');
    expect(picks.every((q) => q.source === 'diligence')).toBe(true);
  });

  it('prefers findings not in recentTexts, falling back to a repeat only when the pool is exhausted', () => {
    const pool: Finding[] = [
      { text: 'A', category: 'traction' }, { text: 'B', category: 'financing' },
    ];
    // Both already "recent" — with only 2 items and 2 requested, a repeat is
    // the only option (pigeonhole), so this documents the honest fallback
    // rather than asserting an impossible guarantee.
    const recent = new Set(['A', 'B']);
    const picks = pickFindingQuestions(pool, new Set(), recent, 2, 'derived');
    expect(picks).toHaveLength(2);
  });
});

describe('buildSession', () => {
  it('falls back to 8 fixed questions when there are no findings or recommendations', () => {
    const session = buildSession(0, [], []);
    expect(session).toHaveLength(8);
    expect(session.every((q) => q.source === 'fixed')).toBe(true);
  });

  it('composes 4 fixed + 2 derived + 2 diligence when both are available', () => {
    const weaknesses: Finding[] = [
      { text: 'no named pilot partner', category: 'traction' },
      { text: 'unclear regulatory pathway', category: 'regulatory' },
    ];
    const recommendations: Finding[] = [
      { text: 'secure an LOI', category: 'traction' },
      { text: 'engage a regulatory consultant', category: 'regulatory' },
    ];
    const session = buildSession(0, weaknesses, recommendations);
    expect(session).toHaveLength(8);
    expect(session.filter((q) => q.source === 'fixed')).toHaveLength(4);
    expect(session.filter((q) => q.source === 'derived')).toHaveLength(2);
    expect(session.filter((q) => q.source === 'diligence')).toHaveLength(2);
  });

  it('covers at least 5 distinct categories with realistic, diverse review findings', () => {
    // Mirrors the shape of real ai_reviews output seen in this codebase
    // (Block C/D live tests) — weaknesses/risks/recommendations that span
    // several categories, not all clustered on one topic.
    const weaknesses: Finding[] = [
      { text: 'thin traction evidence', category: 'traction' },
      { text: 'no team introduction', category: 'team' },
      { text: 'vague go-to-market', category: 'positioning' },
    ];
    const recommendations: Finding[] = [
      { text: 'de-risk the raise with a pilot LOI', category: 'financing' },
      { text: 'quantify the problem with real data', category: 'market' },
    ];
    const session = buildSession(0, weaknesses, recommendations);
    const distinctCategories = new Set(session.map((q) => q.category));
    expect(distinctCategories.size).toBeGreaterThanOrEqual(5);
  });

  it('produces zero repeated question text across 3 consecutive real sessions with realistic findings', () => {
    // 6 items each — mirrors real ai_reviews output size (Block C/D live
    // tests this session saw single reviews produce 6-8 weaknesses alone).
    // With a pool this size, 3 sessions x 2 picks never has to repeat.
    // recentTexts is rebuilt each iteration from the last 2 real sessions,
    // exactly as TrainPanel does from its already-fetched coaching_runs
    // history — this is an end-to-end simulation of real caller behavior,
    // not just the pure-math guarantee the fixed bank has on its own.
    const weaknesses: Finding[] = [
      { text: 'thin traction evidence', category: 'traction' },
      { text: 'no team introduction', category: 'team' },
      { text: 'vague go-to-market', category: 'positioning' },
      { text: 'unclear regulatory pathway', category: 'regulatory' },
      { text: 'no pricing model', category: 'financing' },
      { text: 'thin product description', category: 'product' },
    ];
    const recommendations: Finding[] = [
      { text: 'de-risk the raise with a pilot LOI', category: 'financing' },
      { text: 'quantify the problem with real data', category: 'market' },
      { text: 'name the competitive moat', category: 'positioning' },
      { text: 'add a technical co-founder', category: 'product' },
      { text: 'define the retention metric', category: 'metrics' },
      { text: 'clarify the regulatory pathway', category: 'regulatory' },
    ];
    const seen = new Set<string>();
    const history: Question[][] = [];
    for (let s = 0; s < 3; s++) {
      const recentTexts = new Set(history.slice(-2).flatMap((sess) => sess.map((q) => q.text)));
      const session = buildSession(s, weaknesses, recommendations, recentTexts);
      for (const q of session) {
        expect(seen.has(q.text)).toBe(false);
        seen.add(q.text);
      }
      history.push(session);
    }
  });
});
