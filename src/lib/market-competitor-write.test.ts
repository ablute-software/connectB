import { describe, expect, it } from 'vitest';
import { relationForCompetitorType } from './market-competitor-write';
import type { PlayerStructured } from './market-research-structured';

describe('relationForCompetitorType', () => {
  it('maps direct to direct', () => {
    expect(relationForCompetitorType('direct')).toBe('direct');
  });
  it('maps emerging and potential_entrant to adjacent', () => {
    expect(relationForCompetitorType('emerging')).toBe('adjacent');
    expect(relationForCompetitorType('potential_entrant')).toBe('adjacent');
  });
  it('maps functional, budget and status_quo to indirect', () => {
    expect(relationForCompetitorType('functional')).toBe('indirect');
    expect(relationForCompetitorType('budget')).toBe('indirect');
    expect(relationForCompetitorType('status_quo')).toBe('indirect');
  });
  it('covers all six PlayerStructured competitorType values with no gaps', () => {
    const types: PlayerStructured['competitorType'][] = ['direct', 'functional', 'budget', 'status_quo', 'emerging', 'potential_entrant'];
    for (const t of types) {
      expect(() => relationForCompetitorType(t)).not.toThrow();
      expect(['direct', 'indirect', 'adjacent']).toContain(relationForCompetitorType(t));
    }
  });
});
