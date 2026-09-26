import { describe, expect, it } from 'vitest';
import { researchStateLabel } from './research-state';

describe('researchStateLabel', () => {
  it('says not yet researched when enrichment_status is not "enriched"', () => {
    expect(researchStateLabel('pending', null, null)).toBe('Not yet researched by the platform');
    expect(researchStateLabel(null, null, null)).toBe('Not yet researched by the platform');
  });

  it('uses enriched_at when present', () => {
    expect(researchStateLabel('enriched', '2026-08-08T17:23:12Z', '2026-01-01T00:00:00Z'))
      .toBe('Researched by the platform · last updated 2026-08-08');
  });

  // The real-world case (Ana Terra, confirmed against production
  // 2026-09-25): enrichment_status='enriched', enriched_at NULL, but
  // catalog_people_research.updated_at = 2026-08-08.
  it('falls back to research.updated_at when enriched_at is null', () => {
    expect(researchStateLabel('enriched', null, '2026-08-08T17:23:12.724+00'))
      .toBe('Researched by the platform · last updated 2026-08-08');
  });

  it('says researched with no date when neither timestamp exists', () => {
    expect(researchStateLabel('enriched', null, null)).toBe('Researched by the platform');
  });
});
