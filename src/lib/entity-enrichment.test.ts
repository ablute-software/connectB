import { describe, expect, it } from 'vitest';
import {
  isKnownEntityField, coerceEnrichmentValue, entityHasValue, prepareEnrichmentProposals,
  knownEnrichmentValues, buildEntityEnrichmentPrompt, ENTITY_ENRICHMENT_FIELDS,
} from './entity-enrichment';
import type { Entity } from './types';

function ent(p: Partial<Entity> = {}): Entity {
  return {
    id: 'e1', name: 'One Planet', type: 'vc', invests_in_geographies: [], sectors: [],
    website_verified: false, email_domain_verified: false, submission_channel_type: 'unknown',
    hard_filter_status: 'none', status: 'not_contacted',
    ...p,
  } as Entity;
}

describe('isKnownEntityField', () => {
  it('accepts every field in the enrichment list', () => {
    for (const f of ENTITY_ENRICHMENT_FIELDS) expect(isKnownEntityField(f)).toBe(true);
  });

  it('rejects an unrecognised/arbitrary field name — never write an arbitrary column', () => {
    expect(isKnownEntityField('is_platform_admin')).toBe(false);
    expect(isKnownEntityField('id')).toBe(false);
    expect(isKnownEntityField('')).toBe(false);
  });
});

describe('coerceEnrichmentValue', () => {
  it('splits sectors/geographies on commas and trims', () => {
    expect(coerceEnrichmentValue('sectors', 'climate tech, deep tech,  hardware')).toEqual(['climate tech', 'deep tech', 'hardware']);
    expect(coerceEnrichmentValue('invests_in_geographies', 'Europe, Global')).toEqual(['Europe', 'Global']);
  });

  it('returns undefined for an empty/blank list value', () => {
    expect(coerceEnrichmentValue('sectors', '')).toBeUndefined();
    expect(coerceEnrichmentValue('sectors', '   ')).toBeUndefined();
  });

  it('parses a plain or currency-formatted number for check sizes', () => {
    expect(coerceEnrichmentValue('check_min_eur', '250000')).toBe(250000);
    expect(coerceEnrichmentValue('check_max_eur', '€1,500,000')).toBe(1500000);
  });

  it('drops a check-size value that is not a positive number', () => {
    expect(coerceEnrichmentValue('check_min_eur', 'undisclosed')).toBeUndefined();
    expect(coerceEnrichmentValue('check_min_eur', '0')).toBeUndefined();
    expect(coerceEnrichmentValue('check_min_eur', '-5')).toBeUndefined();
  });

  it('normalises stage phrasing to the exact Stage enum', () => {
    expect(coerceEnrichmentValue('stage_min', 'Pre-Seed')).toBe('pre_seed');
    expect(coerceEnrichmentValue('stage_min', 'seed')).toBe('seed');
    expect(coerceEnrichmentValue('stage_max', 'Series A')).toBe('series_a');
    expect(coerceEnrichmentValue('stage_max', 'Growth')).toBe('later');
  });

  it('drops an unrecognisable stage phrase rather than guessing', () => {
    expect(coerceEnrichmentValue('stage_min', 'somewhere in between')).toBeUndefined();
  });

  it('trims plain string fields and drops empty ones', () => {
    expect(coerceEnrichmentValue('website', '  https://oneplanet.capital  ')).toBe('https://oneplanet.capital');
    expect(coerceEnrichmentValue('thesis', '')).toBeUndefined();
  });
});

describe('entityHasValue', () => {
  it('is false for an unset scalar or empty array', () => {
    const e = ent();
    expect(entityHasValue(e, 'website')).toBe(false);
    expect(entityHasValue(e, 'sectors')).toBe(false);
  });

  it('is true once a scalar or non-empty array is set', () => {
    const e = ent({ website: 'https://oneplanet.capital', sectors: ['climate'] });
    expect(entityHasValue(e, 'website')).toBe(true);
    expect(entityHasValue(e, 'sectors')).toBe(true);
  });
});

describe('prepareEnrichmentProposals (the non-clobbering + validation pipeline)', () => {
  it('keeps a well-formed proposal for a genuinely empty field', () => {
    const e = ent();
    const proposals = prepareEnrichmentProposals(e, [
      { field: 'website', value: 'https://oneplanet.capital', confidence: 0.95, source_url: 'https://oneplanet.capital' },
    ]);
    expect(proposals).toEqual([{ field: 'website', value: 'https://oneplanet.capital', confidence: 0.95, source_url: 'https://oneplanet.capital' }]);
  });

  it('never overwrites a field the entity already has, even with a confident proposal', () => {
    const e = ent({ website: 'https://already-set.example' });
    const proposals = prepareEnrichmentProposals(e, [
      { field: 'website', value: 'https://oneplanet.capital', confidence: 0.99, source_url: 'https://oneplanet.capital' },
    ]);
    expect(proposals).toEqual([]);
  });

  it('drops a proposal for a field name outside the known list', () => {
    const e = ent();
    const proposals = prepareEnrichmentProposals(e, [
      { field: 'is_platform_admin', value: 'true', confidence: 0.9, source_url: 'https://x.example' },
    ]);
    expect(proposals).toEqual([]);
  });

  it('drops a proposal whose value fails to coerce', () => {
    const e = ent();
    const proposals = prepareEnrichmentProposals(e, [
      { field: 'check_min_eur', value: 'undisclosed', confidence: 0.4, source_url: 'https://x.example' },
    ]);
    expect(proposals).toEqual([]);
  });

  it('processes a full realistic batch (the One Planet case): mixed empty fields, one already-set', () => {
    const e = ent({ thesis: 'already has a thesis on file' });
    const proposals = prepareEnrichmentProposals(e, [
      { field: 'website', value: 'https://oneplanet.capital', confidence: 0.95, source_url: 'https://oneplanet.capital' },
      { field: 'sectors', value: 'climate tech', confidence: 0.9, source_url: 'https://oneplanet.capital/about' },
      { field: 'stage_min', value: 'pre-seed', confidence: 0.85, source_url: 'https://oneplanet.capital' },
      { field: 'thesis', value: 'Should be dropped — already set', confidence: 0.9, source_url: 'https://oneplanet.capital' },
    ]);
    expect(proposals.map((p) => p.field)).toEqual(['website', 'sectors', 'stage_min']);
  });
});

describe('knownEnrichmentValues', () => {
  it('lists only the fields the entity already has, for the "don\'t re-propose" prompt hint', () => {
    const e = ent({ website: 'https://x.example', sectors: ['fintech'] });
    expect(knownEnrichmentValues(e)).toEqual({ website: 'https://x.example', sectors: ['fintech'] });
  });

  it('is empty for a fully-blank entity (the One Planet 0%-complete case)', () => {
    expect(knownEnrichmentValues(ent())).toEqual({});
  });
});

describe('buildEntityEnrichmentPrompt', () => {
  it('names the entity, lists the target fields, and states the anti-hallucination + no-LinkedIn rules', () => {
    const prompt = buildEntityEnrichmentPrompt('One Planet', {});
    expect(prompt).toContain('One Planet');
    expect(prompt).toContain('Never use LinkedIn as a source');
    expect(prompt).toContain('do not guess or invent');
    for (const f of ENTITY_ENRICHMENT_FIELDS) expect(prompt).toContain(f);
  });

  it('tells the model what is already known so it fills gaps, not repeats', () => {
    const prompt = buildEntityEnrichmentPrompt('One Planet', { website: 'https://oneplanet.capital' });
    expect(prompt).toContain('oneplanet.capital');
    expect(prompt).toContain('do not re-propose');
  });
});
