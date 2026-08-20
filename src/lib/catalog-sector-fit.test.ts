import { describe, it, expect } from 'vitest';
import { catalogEntitySectorFit } from './catalog-sector-fit';

const HEALTH_ORG_SECTORS = ['Digital Health', 'MedTech & Medical Devices'];
const FINTECH_ORG_SECTORS = ['FinTech & InsurTech', 'Cybersecurity'];

describe('catalogEntitySectorFit', () => {
  it('is not_applicable when the entity was never delivered anywhere', () => {
    expect(catalogEntitySectorFit(['healthtech'], null, [])).toBe('not_applicable');
  });

  it('is fit when free-text sectors contain a compound healthtech word not literally in the taxonomy', () => {
    // Real production case: GapMinder-style free text ('healthtech') has no
    // shared word with any canonical Health & Life Sciences name — plain
    // substring matching is what catches it, word-boundary matching would not.
    expect(catalogEntitySectorFit(['healthtech'], null, [HEALTH_ORG_SECTORS])).toBe('fit');
  });

  it('is fit on biotech/medtech/pharma free text', () => {
    expect(catalogEntitySectorFit(['biotech'], null, [HEALTH_ORG_SECTORS])).toBe('fit');
    expect(catalogEntitySectorFit(['medtech'], null, [HEALTH_ORG_SECTORS])).toBe('fit');
    expect(catalogEntitySectorFit(null, 'We back pharma and biotech founders.', [HEALTH_ORG_SECTORS])).toBe('fit');
  });

  it('is low_fit when delivered to a health org but sectors/thesis show no health signal', () => {
    // The real bug this prompt fixes: GapMinder (AI/Deeptech/SaaS B2B) was
    // enriched first because it was cheapest-to-complete, not because it fit.
    expect(catalogEntitySectorFit(['enterprise automation', 'cybersec', 'fintech'], 'AI-native B2B SaaS for the enterprise.', [HEALTH_ORG_SECTORS])).toBe('low_fit');
  });

  it('is fit when the entity explicitly declares itself a generalist, regardless of category', () => {
    expect(catalogEntitySectorFit(['fintech'], 'We are a generalist fund investing across sectors.', [HEALTH_ORG_SECTORS])).toBe('fit');
    expect(catalogEntitySectorFit(null, 'Sector-agnostic early-stage investor.', [HEALTH_ORG_SECTORS])).toBe('fit');
  });

  it('is not_applicable when delivered only to orgs outside the one category this file covers', () => {
    // Deliberately distinct from low_fit: we have no keyword coverage for
    // fintech-org fit yet, so we must not claim "no fit" for it.
    expect(catalogEntitySectorFit(['healthtech'], null, [FINTECH_ORG_SECTORS])).toBe('not_applicable');
  });

  it('is fit if ANY delivered org is a health org, even alongside a non-health one', () => {
    expect(catalogEntitySectorFit(['biotech'], null, [FINTECH_ORG_SECTORS, HEALTH_ORG_SECTORS])).toBe('fit');
  });

  it('handles null/empty sectors and thesis without throwing', () => {
    expect(catalogEntitySectorFit(null, null, [HEALTH_ORG_SECTORS])).toBe('low_fit');
    expect(catalogEntitySectorFit([], '', [HEALTH_ORG_SECTORS])).toBe('low_fit');
  });
});
