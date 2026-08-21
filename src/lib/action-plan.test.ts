import { describe, expect, it } from 'vitest';
import {
  jaccard, tokenize, clusterActions, clusterPriority, extractActions, dataroomChecklist, latestPerKind, joinNatural,
  genuineContradictions, findMatchingSolution, type Action, type AiReviewRow, type Contradiction,
} from './action-plan';

describe('jaccard / tokenize', () => {
  it('scores near-identical text above the 0.6 merge threshold', () => {
    const a = tokenize('Go-to-market is vague, no named partners or channel economics.');
    const b = tokenize('Go-to-market is vague, no named partners or channel economics stated.');
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  it('scores unrelated text below the threshold', () => {
    const a = tokenize('Team lacks a technical co-founder with regulatory experience.');
    const b = tokenize('Pricing model is not disclosed anywhere in the deck.');
    expect(jaccard(a, b)).toBeLessThan(0.6);
  });

  it('is symmetric and zero for an empty set', () => {
    expect(jaccard(new Set(), tokenize('anything'))).toBe(0);
    expect(jaccard(tokenize('cat dog bird'), tokenize('bird dog cat'))).toBe(1);
  });
});

function action(overrides: Partial<Action>): Action {
  return {
    text: 'placeholder', category: 'other', type: 'weakness', severity: 'medium',
    sourceKind: 'Pitch deck', sourceReviewId: 'r1', createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('clusterActions', () => {
  it('merges near-duplicate findings of the same type from different documents', () => {
    const actions: Action[] = [
      action({ text: 'Go-to-market is vague, no named partners or channel economics.', sourceReviewId: 'deck-1' }),
      action({ text: 'Go-to-market is vague, no named partners or channel economics stated.', sourceReviewId: 'bizplan-1' }),
      action({ text: 'Team lacks a technical co-founder with regulatory experience.', sourceReviewId: 'deck-1' }),
    ];
    const clusters = clusterActions(actions);
    expect(clusters).toHaveLength(2);
    const merged = clusters.find((c) => c.items.length === 2);
    expect(merged).toBeDefined();
    expect(new Set(merged!.items.map((i) => i.sourceReviewId))).toEqual(new Set(['deck-1', 'bizplan-1']));
  });

  it('never merges across different finding types even with identical text', () => {
    const sameText = 'Unclear pricing strategy for the core product.';
    const actions: Action[] = [
      action({ text: sameText, type: 'weakness' }),
      action({ text: sameText, type: 'risk' }),
    ];
    expect(clusterActions(actions)).toHaveLength(2);
  });
});

describe('clusterPriority', () => {
  it('ranks recurrence across documents above severity', () => {
    const recurring = { items: [
      action({ severity: 'low', sourceReviewId: 'a', createdAt: '2026-01-01T00:00:00Z' }),
      action({ severity: 'low', sourceReviewId: 'b', createdAt: '2026-01-01T00:00:00Z' }),
    ] };
    const singleHigh = { items: [action({ severity: 'high', sourceReviewId: 'a', createdAt: '2026-01-01T00:00:00Z' })] };
    expect(clusterPriority(recurring)).toBeGreaterThan(clusterPriority(singleHigh));
  });

  it('ranks severity above recency when recurrence ties', () => {
    const high = { items: [action({ severity: 'high', createdAt: '2026-01-01T00:00:00Z' })] };
    const lowButRecent = { items: [action({ severity: 'low', createdAt: '2026-06-01T00:00:00Z' })] };
    expect(clusterPriority(high)).toBeGreaterThan(clusterPriority(lowButRecent));
  });

  it('breaks ties on recency when recurrence and severity are equal', () => {
    const older = { items: [action({ severity: 'medium', createdAt: '2026-01-01T00:00:00Z' })] };
    const newer = { items: [action({ severity: 'medium', createdAt: '2026-06-01T00:00:00Z' })] };
    expect(clusterPriority(newer)).toBeGreaterThan(clusterPriority(older));
  });
});

describe('extractActions', () => {
  it('flattens weaknesses/risks/recommendations from every review, tagging source and type', () => {
    const reviews: AiReviewRow[] = [{
      id: 'r1', kind: 'deck_review', created_at: '2026-01-01T00:00:00Z',
      result: {
        score: 4, summary: 's',
        strengths: ['ok team'],
        weaknesses: [{ text: 'thin traction', category: 'traction', severity: 'high' }],
        risks: [{ text: 'regulatory risk', category: 'regulatory', severity: 'medium' }],
        recommendations: [{ text: 'get an LOI', category: 'traction' }],
      },
    }];
    const actions = extractActions(reviews);
    expect(actions).toHaveLength(3);
    expect(actions.find((a) => a.type === 'weakness')?.severity).toBe('high');
    expect(actions.find((a) => a.type === 'recommendation')?.severity).toBeNull();
    expect(actions.every((a) => a.sourceKind === 'Pitch deck')).toBe(true);
  });

  it('skips reviews with no result (e.g. still pending)', () => {
    expect(extractActions([{ id: 'r1', kind: 'deck_review', created_at: '2026-01-01T00:00:00Z', result: null }])).toEqual([]);
  });
});

describe('latestPerKind', () => {
  it('keeps only the most recent row per kind', () => {
    const reviews: AiReviewRow[] = [
      { id: 'old', kind: 'deck_review', created_at: '2026-01-01T00:00:00Z', result: null },
      { id: 'new', kind: 'deck_review', created_at: '2026-02-01T00:00:00Z', result: null },
      { id: 'bizplan', kind: 'business_plan_review', created_at: '2026-01-15T00:00:00Z', result: null },
    ];
    const result = latestPerKind(reviews);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.kind === 'deck_review')?.id).toBe('new');
    expect(result.find((r) => r.kind === 'business_plan_review')?.id).toBe('bizplan');
  });

  it('is order-independent — the latest wins regardless of input order', () => {
    const reviews: AiReviewRow[] = [
      { id: 'new', kind: 'deck_review', created_at: '2026-02-01T00:00:00Z', result: null },
      { id: 'old', kind: 'deck_review', created_at: '2026-01-01T00:00:00Z', result: null },
    ];
    expect(latestPerKind(reviews)[0].id).toBe('new');
  });

  it('regression: re-analyzing the same deck twice must not read as two documents', () => {
    // The exact pathological case from the P115 verification mini-prompt:
    // ai_reviews has no document_id, so two independent reads of the SAME
    // deck are indistinguishable from two different documents unless we
    // dedupe by kind first. Without latestPerKind, a weakness recurring
    // across these two rows would outrank a genuinely single-document high-
    // severity issue — exactly backwards.
    const sameWeakness = 'Go-to-market is vague, no named partners or channel economics.';
    const reviews: AiReviewRow[] = [
      { id: 'deck-read-1', kind: 'deck_review', created_at: '2026-01-01T09:08:57Z', result: {
        score: 5, summary: 's', strengths: [],
        weaknesses: [{ text: sameWeakness, category: 'traction', severity: 'high' }],
        risks: [], recommendations: [],
      } },
      { id: 'deck-read-2', kind: 'deck_review', created_at: '2026-01-01T09:09:42Z', result: {
        score: 5, summary: 's', strengths: [],
        weaknesses: [{ text: sameWeakness, category: 'traction', severity: 'high' }],
        risks: [], recommendations: [],
      } },
    ];
    const deduped = latestPerKind(reviews);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe('deck-read-2');
    const actions = extractActions(deduped);
    const clusters = clusterActions(actions);
    expect(clusters).toHaveLength(1);
    expect(new Set(clusters[0].items.map((i) => i.sourceKind)).size).toBe(1); // one document type, not two
  });
});

describe('joinNatural', () => {
  it('joins two items with "and"', () => {
    expect(joinNatural(['Pitch deck', 'Financial plan'])).toBe('Pitch deck and Financial plan');
  });

  it('joins three+ items with an Oxford comma', () => {
    expect(joinNatural(['Pitch deck', 'Financial plan', 'Business plan'])).toBe('Pitch deck, Financial plan, and Business plan');
  });

  it('returns the single item unchanged', () => {
    expect(joinNatural(['Pitch deck'])).toBe('Pitch deck');
  });
});

describe('genuineContradictions', () => {
  function contradiction(overrides: Partial<Contradiction>): Contradiction {
    return {
      text: 'placeholder', category: 'other', severity: 'medium',
      sideA: { kind: 'deck_review', quote: 'a' }, sideB: { kind: 'financial_plan_review', quote: 'b' },
      ...overrides,
    };
  }

  it('keeps a contradiction between two different document kinds', () => {
    const c = contradiction({});
    expect(genuineContradictions([c])).toEqual([c]);
  });

  it('drops a "contradiction" between two reads of the same document kind', () => {
    // The exact failure mode Block D must not repeat: two independent reads
    // of the same deck are not a cross-document contradiction.
    const c = contradiction({ sideA: { kind: 'deck_review', quote: 'a' }, sideB: { kind: 'deck_review', quote: 'b' } });
    expect(genuineContradictions([c])).toEqual([]);
  });
});

describe('dataroomChecklist', () => {
  it('flags a document present by name keyword match', () => {
    const checklist = dataroomChecklist([], [{ name: 'ablute_ Pitch Deck v3.pdf' }]);
    expect(checklist.find((c) => c.label === 'Pitch deck')?.present).toBe(true);
    expect(checklist.find((c) => c.label === 'Cap table')?.present).toBe(false);
  });

  it('flags a document present by folder keyword match', () => {
    const checklist = dataroomChecklist([{ name: 'Corporate & Governance' }], []);
    expect(checklist.find((c) => c.label === 'Corporate / governance documents')?.present).toBe(true);
  });
});

describe('findMatchingSolution — Prompt 302 §1, problem/solution pairing', () => {
  it('pairs a weakness with a same-category recommendation that shares real overlap', () => {
    const problem = { items: [action({ text: 'Go-to-market plan has no named channel partners or pricing.', category: 'traction' })] };
    const all: Action[] = [
      action({ type: 'recommendation', category: 'traction', text: 'Add named channel partners and a clear pricing model to the go-to-market section.' }),
      action({ type: 'recommendation', category: 'team', text: 'Hire a technical co-founder.' }),
    ];
    const match = findMatchingSolution(problem, all);
    expect(match?.text).toBe('Add named channel partners and a clear pricing model to the go-to-market section.');
  });

  it('never pairs across categories even with high text overlap', () => {
    const problem = { items: [action({ text: 'Team lacks a technical co-founder.', category: 'team' })] };
    const all: Action[] = [
      action({ type: 'recommendation', category: 'traction', text: 'Team lacks a technical co-founder — add one.' }),
    ];
    expect(findMatchingSolution(problem, all)).toBeNull();
  });

  it('returns null (honest "no suggestion yet") when nothing clears the similarity bar', () => {
    const problem = { items: [action({ text: 'Cap table shows an unusual liquidation preference stack.', category: 'other' })] };
    const all: Action[] = [
      action({ type: 'recommendation', category: 'other', text: 'Hire a marketing lead.' }),
    ];
    expect(findMatchingSolution(problem, all)).toBeNull();
  });
});
