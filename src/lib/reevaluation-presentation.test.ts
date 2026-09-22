import { describe, expect, it } from 'vitest';
import { MAX_REEVALUATIONS_PER_CALL, isOutOfCurrentMandate, selectReevaluationsToPresent, type ReevaluationCandidate } from './reevaluation-presentation';

const candidate = (id: string, fulfilledAt: string): ReevaluationCandidate => ({
  id, orgId: `org-${id}`, conditionKind: 'pilot_completed', obstacle: 'too_early', fulfilledAt, fulfilledFactText: 'fact',
});

describe('selectReevaluationsToPresent', () => {
  it(`never presents more than ${MAX_REEVALUATIONS_PER_CALL} per call, even with more waiting`, () => {
    expect(MAX_REEVALUATIONS_PER_CALL).toBe(2);
    const candidates = [candidate('a', '2026-11-01'), candidate('b', '2026-11-02'), candidate('c', '2026-11-03')];
    const result = selectReevaluationsToPresent(candidates);
    expect(result).toHaveLength(2);
  });

  it('picks the OLDEST fulfilled conditions first — "por ordem de data do alerta"', () => {
    const candidates = [candidate('newest', '2026-11-05'), candidate('oldest', '2026-11-01'), candidate('middle', '2026-11-03')];
    const result = selectReevaluationsToPresent(candidates);
    expect(result.map((c) => c.id)).toEqual(['oldest', 'middle']);
  });

  it('presents everything when there are fewer than the cap', () => {
    const candidates = [candidate('a', '2026-11-01')];
    expect(selectReevaluationsToPresent(candidates)).toHaveLength(1);
  });

  it('presents nothing when nothing is waiting', () => {
    expect(selectReevaluationsToPresent([])).toEqual([]);
  });
});

describe('isOutOfCurrentMandate', () => {
  it('is true when the current thesis excludes the startup', () => {
    expect(isOutOfCurrentMandate(['excluded'])).toBe(true);
  });
  it('is false for an ordinary match reasons list', () => {
    expect(isOutOfCurrentMandate(['sector', 'stage'])).toBe(false);
    expect(isOutOfCurrentMandate([])).toBe(false);
  });
});
