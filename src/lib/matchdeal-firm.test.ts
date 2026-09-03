import { describe, expect, it } from 'vitest';
import { firmHasProfileDetail, firmStageRange, type MatchDealFirm } from './matchdeal-firm';
import { computeFirmSummaryPrefill } from './entity-catalog-prefill';
import type { Entity } from './types';

// Prompt 555 — the founder side read the catalog STUB. For a self-registered
// investor that row is empty by construction, so a filled-in MatchDeal
// profile rendered an empty dossier. These pin the read path's half of the
// fix; the SQL projection is verified against the real database.

const EMPTY_ENTITY = {
  id: 'e1', name: 'Investor', sectors: [], source: 'match_deal',
} as unknown as Entity;

describe('firmStageRange — MatchDeal stages -> the CRM Stage union', () => {
  it('maps series_b_plus and growth onto later (the CRM has no finer bucket)', () => {
    expect(firmStageRange({ stages_invested: ['series_b_plus'] })).toEqual({ min: 'later', max: 'later' });
    expect(firmStageRange({ stages_invested: ['growth'] })).toEqual({ min: 'later', max: 'later' });
  });

  it('takes the min and max by MatchDeal order, not array order', () => {
    expect(firmStageRange({ stages_invested: ['growth', 'pre_seed', 'seed'] }))
      .toEqual({ min: 'pre_seed', max: 'later' });
  });

  it('the real production firm: five stages -> pre_seed..later', () => {
    expect(firmStageRange({ stages_invested: ['pre_seed', 'seed', 'series_a', 'series_b_plus', 'growth'] }))
      .toEqual({ min: 'pre_seed', max: 'later' });
  });

  it('ignores stages the CRM has no bucket for, rather than inventing one', () => {
    expect(firmStageRange({ stages_invested: ['bridge_round_v2'] })).toEqual({});
  });

  it('is empty for no firm and no stages', () => {
    expect(firmStageRange(null)).toEqual({});
    expect(firmStageRange({})).toEqual({});
  });
});

describe('computeFirmSummaryPrefill — the founder never gets overwritten', () => {
  const FIRM: MatchDealFirm = {
    website: 'ablute.pt', country: 'Portugal', sectors: ['healthtech'],
    stages_invested: ['pre_seed', 'seed'], ticket_min: 10000, ticket_max: 6875000,
    description: 'We back regulated healthtech at pre-seed.',
  };

  it('fills every field the founder left empty', () => {
    expect(computeFirmSummaryPrefill(EMPTY_ENTITY, FIRM)).toEqual({
      website: 'ablute.pt', hqCountry: 'Portugal', sectors: ['healthtech'],
      stageMin: 'pre_seed', stageMax: 'seed',
      checkMinEur: 10000, checkMaxEur: 6875000,
      thesis: 'We back regulated healthtech at pre-seed.',
    });
  });

  it('yields NOTHING the founder already typed', () => {
    const filled = {
      ...EMPTY_ENTITY, website: 'their-own.com', hq_country: 'Spain',
      sectors: ['fintech'], stage_min: 'seed', stage_max: 'series_a',
      check_min_eur: 1, check_max_eur: 2, thesis: 'My own note',
    } as unknown as Entity;
    expect(computeFirmSummaryPrefill(filled, FIRM)).toEqual({});
  });

  it('falls back to the investor’s stated criteria when they wrote no description', () => {
    // Same order matchdeal_apply_firm_to_entity uses when it writes.
    expect(computeFirmSummaryPrefill(EMPTY_ENTITY, { specific_criteria: 'B2B only' }).thesis).toBe('B2B only');
    expect(computeFirmSummaryPrefill(EMPTY_ENTITY, { description: 'D', specific_criteria: 'C' }).thesis).toBe('D');
  });

  it('treats a HIDDEN field as absent, never as an empty value', () => {
    // The projection omits hidden fields entirely, so there is nothing to
    // render and nothing to imply was withheld.
    const hidden: MatchDealFirm = { ...FIRM };
    delete hidden.ticket_min; delete hidden.ticket_max;
    const out = computeFirmSummaryPrefill(EMPTY_ENTITY, hidden);
    expect('checkMinEur' in out).toBe(false);
    expect('checkMaxEur' in out).toBe(false);
  });

  it('is empty for no firm at all — a catalog-born investor keeps its own path', () => {
    expect(computeFirmSummaryPrefill(EMPTY_ENTITY, null)).toEqual({});
  });
});

describe('firmHasProfileDetail — the card renders only when there is something to show', () => {
  it('is false for null and for a firm carrying only summary fields', () => {
    expect(firmHasProfileDetail(null)).toBe(false);
    expect(firmHasProfileDetail({ website: 'x.com', country: 'Portugal' })).toBe(false);
  });

  it('is true once any profile-only field is present', () => {
    expect(firmHasProfileDetail({ lead_or_colead: 'lead' })).toBe(true);
    expect(firmHasProfileDetail({ instruments: ['equity'] })).toBe(true);
    expect(firmHasProfileDetail({ active_fund: 'Fund II' })).toBe(true);
  });

  it('treats does_follow_on: false as a real answer, not as absence', () => {
    // "We do not do follow-on" is information a founder needs.
    expect(firmHasProfileDetail({ does_follow_on: false })).toBe(true);
    expect(firmHasProfileDetail({ accepts_cold_contact: false })).toBe(true);
  });
});
