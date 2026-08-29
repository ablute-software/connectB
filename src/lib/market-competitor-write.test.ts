import { describe, expect, it } from 'vitest';
import { relationForCompetitorType } from './market-competitor-write';
import type { ScoredClassification } from './market-competition';

describe('relationForCompetitorType', () => {
  it('maps DIRECT to direct', () => {
    expect(relationForCompetitorType('DIRECT')).toBe('direct');
  });
  it('maps EMERGING, POTENTIAL_ENTRANT and ADJACENT to adjacent', () => {
    expect(relationForCompetitorType('EMERGING')).toBe('adjacent');
    expect(relationForCompetitorType('POTENTIAL_ENTRANT')).toBe('adjacent');
    expect(relationForCompetitorType('ADJACENT')).toBe('adjacent');
  });
  it('maps FUNCTIONAL and BUDGET to indirect', () => {
    expect(relationForCompetitorType('FUNCTIONAL')).toBe('indirect');
    expect(relationForCompetitorType('BUDGET')).toBe('indirect');
  });
  it('covers every ScoredClassification value reachable from respond/route.ts with no gaps', () => {
    // Prompt 455 — NOT_COMPETITOR/UNRESOLVED (and STATUS_QUO) are no longer
    // part of ScoredClassification at all: it's narrowed to the 6 values
    // that can actually become an org_competitors row, so TS itself now
    // rules out passing them here — this loop only needs the 6 real members.
    const types: ScoredClassification[] = ['DIRECT', 'FUNCTIONAL', 'BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT'];
    for (const t of types) {
      expect(() => relationForCompetitorType(t)).not.toThrow();
      expect(['direct', 'indirect', 'adjacent']).toContain(relationForCompetitorType(t));
    }
  });
});
