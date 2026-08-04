import { describe, expect, it } from 'vitest';
import { severityToNumeric, buildAiReviewFacts } from './ecosystem-facts-shape';

describe('severityToNumeric', () => {
  it('maps low/medium/high to 1/2/3', () => {
    expect(severityToNumeric('low')).toBe(1);
    expect(severityToNumeric('medium')).toBe(2);
    expect(severityToNumeric('high')).toBe(3);
  });
});

describe('buildAiReviewFacts', () => {
  it('emits a review_score fact only when a score is given', () => {
    const withScore = buildAiReviewFacts({ orgId: 'org-1', reviewId: 'rev-1', score: 72 });
    expect(withScore).toEqual([
      { org_id: 'org-1', metric_key: 'review_score', value_numeric: 72, source: 'ai_review', source_id: 'rev-1' },
    ]);

    const withoutScore = buildAiReviewFacts({ orgId: 'org-1', reviewId: 'rev-1' });
    expect(withoutScore).toEqual([]);
  });

  it('emits one weakness_prevalence fact per weakness, category+severity carried through', () => {
    const rows = buildAiReviewFacts({
      orgId: 'org-1', reviewId: 'rev-1',
      weaknesses: [{ category: 'financing', severity: 'high' }, { category: 'team', severity: 'low' }],
    });
    expect(rows).toEqual([
      { org_id: 'org-1', metric_key: 'weakness_prevalence', value_category: 'financing', value_numeric: 3, source: 'ai_review', source_id: 'rev-1' },
      { org_id: 'org-1', metric_key: 'weakness_prevalence', value_category: 'team', value_numeric: 1, source: 'ai_review', source_id: 'rev-1' },
    ]);
  });

  it('emits one risk_prevalence fact per risk', () => {
    const rows = buildAiReviewFacts({
      orgId: 'org-1', reviewId: 'rev-1',
      risks: [{ category: 'regulatory', severity: 'medium' }],
    });
    expect(rows).toEqual([
      { org_id: 'org-1', metric_key: 'risk_prevalence', value_category: 'regulatory', value_numeric: 2, source: 'ai_review', source_id: 'rev-1' },
    ]);
  });

  it('combines score + weaknesses + risks into one flat list, in that order', () => {
    const rows = buildAiReviewFacts({
      orgId: 'org-1', reviewId: 'rev-1', score: 50,
      weaknesses: [{ category: 'market', severity: 'medium' }],
      risks: [{ category: 'product', severity: 'low' }],
    });
    expect(rows.map((r) => r.metric_key)).toEqual(['review_score', 'weakness_prevalence', 'risk_prevalence']);
  });

  it('never emits free text — every row is only numbers and closed categories', () => {
    const rows = buildAiReviewFacts({
      orgId: 'org-1', reviewId: 'rev-1', score: 10,
      weaknesses: [{ category: 'other', severity: 'high' }],
    });
    const allowedKeys = new Set(['org_id', 'metric_key', 'value_numeric', 'value_category', 'source', 'source_id']);
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(allowedKeys.has(key)).toBe(true);
      if ('value_numeric' in row) expect(typeof row.value_numeric).toBe('number');
      if ('value_category' in row) expect(typeof row.value_category).toBe('string');
    }
  });
});
