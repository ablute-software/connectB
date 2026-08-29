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
    // NOT_COMPETITOR/UNRESOLVED are part of the ScoredClassification type
    // but never actually reach this function in production — respond/
    // route.ts rejects both before addOrUpdateCompetitor is ever called.
    // Still covered here so the mapping itself never throws if that guard
    // is ever bypassed.
    const types: ScoredClassification[] = ['DIRECT', 'FUNCTIONAL', 'BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT', 'NOT_COMPETITOR', 'UNRESOLVED'];
    for (const t of types) {
      expect(() => relationForCompetitorType(t)).not.toThrow();
      expect(['direct', 'indirect', 'adjacent']).toContain(relationForCompetitorType(t));
    }
  });
});
