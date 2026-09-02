// Prompt 541 §A — the round half of the extraction schema. Kept in its own
// file rather than appended to whatever already covers document-extraction:
// these tests are about one question ("when may a document speak about the
// round, and about what") and read better together.
import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_TOOL_SCHEMA, isRoundCompatibleDocumentType, rawExtractionToData,
  rawExtractionToRound, roundInstrumentValue,
} from './document-extraction';

const FULL_ROUND = {
  target_eur: { value: 1300000, page: 4 },
  instruments: { value: ['SAFE'], page: 4 },
  valuation_eur: { value: 6000000, page: 4 },
  valuation_basis: { value: 'pre_money', page: 4 },
  runway_months: { value: 7, page: 9 },
  runway_post_months: { value: 24, page: 9 },
  target_close_date: { value: '2026-12-15', page: 4 },
  use_of_funds: { value: 'Clinical validation, two hires, CE marking.', page: 5 },
  min_ticket_eur: { value: 50000, page: 4 },
};

describe('isRoundCompatibleDocumentType', () => {
  it('accepts the fundraising document types the schema itself names', () => {
    for (const t of ['term sheet', 'Pitch deck', 'one-pager', 'investor teaser', 'round summary', 'SAFE agreement', 'investment memorandum']) {
      expect(isRoundCompatibleDocumentType(t)).toBe(true);
    }
  });

  it('rejects documents that routinely carry a big number and a date but no round', () => {
    for (const t of ['invoice', 'grant agreement', 'certificate', 'employment contract', 'bank statement']) {
      expect(isRoundCompatibleDocumentType(t)).toBe(false);
    }
  });

  it('lets an unknown type through — unknown is not the same as wrong', () => {
    expect(isRoundCompatibleDocumentType(null)).toBe(true);
    expect(isRoundCompatibleDocumentType('   ')).toBe(true);
  });
});

describe('roundInstrumentValue', () => {
  it('maps the words a document uses onto the app enum', () => {
    expect(roundInstrumentValue('SAFE')).toBe('safe');
    expect(roundInstrumentValue('Simple Agreement for Future Equity')).toBe('safe');
    expect(roundInstrumentValue('convertible note')).toBe('convertible_note');
    expect(roundInstrumentValue('venture debt')).toBe('venture_debt');
    expect(roundInstrumentValue('grant / subsidy')).toBe('grant');
    expect(roundInstrumentValue('revenue-based financing')).toBe('revenue_based');
    expect(roundInstrumentValue('ordinary shares')).toBe('equity');
  });

  it('keeps an unrecognised instrument as "other" rather than dropping it', () => {
    expect(roundInstrumentValue('crowdfunding tokens')).toBe('other');
  });
});

describe('rawExtractionToRound', () => {
  it('reads every field a compatible document states, with its page', () => {
    const r = rawExtractionToRound(FULL_ROUND, 'term sheet');
    expect(r).not.toBeNull();
    expect(r?.targetEur).toEqual({ value: 1300000, page: 4 });
    expect(r?.instruments).toEqual({ value: ['safe'], page: 4 });
    expect(r?.valuationBasis).toEqual({ value: 'pre_money', page: 4 });
    expect(r?.targetCloseDate).toEqual({ value: '2026-12-15', page: 4 });
    expect(r?.minTicketEur?.value).toBe(50000);
  });

  it('keeps only the fields present — a partial document is not padded out', () => {
    const r = rawExtractionToRound({ target_eur: { value: 1300000, page: 2 } }, 'pitch deck');
    expect(Object.keys(r ?? {})).toEqual(['targetEur']);
  });

  it('drops the whole block for an incompatible document type', () => {
    expect(rawExtractionToRound(FULL_ROUND, 'grant agreement')).toBeNull();
    expect(rawExtractionToRound(FULL_ROUND, 'invoice')).toBeNull();
  });

  it('returns null when a compatible document simply says nothing about the round', () => {
    expect(rawExtractionToRound(undefined, 'pitch deck')).toBeNull();
    expect(rawExtractionToRound({}, 'pitch deck')).toBeNull();
  });

  it('refuses a zero or negative amount — that is a blank being filled in, not a fact', () => {
    expect(rawExtractionToRound({ target_eur: { value: 0 } }, 'term sheet')).toBeNull();
    expect(rawExtractionToRound({ target_eur: { value: -5 } }, 'term sheet')).toBeNull();
  });

  it('refuses a close date that is not a real ISO date, rather than letting Postgres reject it', () => {
    expect(rawExtractionToRound({ target_close_date: { value: 'Q4 2026' } }, 'term sheet')).toBeNull();
    expect(rawExtractionToRound({ target_close_date: { value: '2026-12-15' } }, 'term sheet')?.targetCloseDate?.value).toBe('2026-12-15');
  });

  it('survives a malformed tool response without throwing', () => {
    expect(rawExtractionToRound('not an object', 'term sheet')).toBeNull();
    expect(rawExtractionToRound({ target_eur: 1300000 }, 'term sheet')).toBeNull();
    expect(rawExtractionToRound({ instruments: { value: 'SAFE' } }, 'term sheet')).toBeNull();
  });

  it('de-duplicates instruments that map to the same enum value', () => {
    const r = rawExtractionToRound({ instruments: { value: ['SAFE', 'safe note', 'Simple Agreement for Future Equity'] } }, 'term sheet');
    expect(r?.instruments?.value).toEqual(['safe']);
  });
});

describe('rawExtractionToData wiring', () => {
  it('carries the round block through, gated on the same document type it reports', () => {
    const data = rawExtractionToData({ document_type: 'term sheet', round: FULL_ROUND }, 3, 3);
    expect(data.round?.targetEur?.value).toBe(1300000);
  });

  it('is null for a document whose own reported type is incompatible', () => {
    const data = rawExtractionToData({ document_type: 'invoice', round: FULL_ROUND }, 3, 3);
    expect(data.round).toBeNull();
  });

  it('leaves every pre-existing extraction field untouched', () => {
    const data = rawExtractionToData({
      document_type: 'grant agreement',
      programs: [{ name: 'WomenTechEU', page: 1 }],
      named_entities: [{ name: 'Nuno', kind: 'person' }],
      is_signed: true,
    }, 2, 5);
    expect(data.programs).toEqual([{ name: 'WomenTechEU', page: 1 }]);
    expect(data.isSigned).toBe(true);
    expect(data.partial).toBe(true);
    expect(data.round).toBeNull();
  });

  it('never asks the model for the round block as a required field', () => {
    expect(EXTRACTION_TOOL_SCHEMA.required).not.toContain('round');
    expect(Object.keys(EXTRACTION_TOOL_SCHEMA.properties)).toContain('round');
  });
});
