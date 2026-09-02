// Prompt 542 §3 — projections are the first thing this extractor records
// that has NOT happened. The tests are mostly about refusal: a projection
// missing any of metric / value / date is not a milestone anyone can put on
// a roadmap, and inventing the missing part is the exact failure mode this
// module is written against.
import { describe, it, expect } from 'vitest';
import { EXTRACTION_TOOL_SCHEMA, rawExtractionToData, rawExtractionToProjections } from './document-extraction';

const GOOD = {
  metric: 'new users', target_value: '1,000', target_date: '2027-04-01',
  date_precision: 'quarter', page: 12,
};

describe('rawExtractionToProjections', () => {
  it('keeps a projection that states metric, value and date', () => {
    expect(rawExtractionToProjections([GOOD])).toEqual([{
      metric: 'new users', targetValue: '1,000', targetDate: '2027-04-01',
      datePrecision: 'quarter', page: 12,
    }]);
  });

  it('drops a projection missing any one of the three parts', () => {
    expect(rawExtractionToProjections([{ ...GOOD, metric: '' }])).toEqual([]);
    expect(rawExtractionToProjections([{ ...GOOD, target_value: '   ' }])).toEqual([]);
    expect(rawExtractionToProjections([{ ...GOOD, target_date: undefined }])).toEqual([]);
  });

  it('drops a target date that is not a real ISO date', () => {
    for (const target_date of ['Q2 2027', '2027', 'end of 2026', '2027-13-01x']) {
      expect(rawExtractionToProjections([{ ...GOOD, target_date }])).toEqual([]);
    }
  });

  it('keeps the value verbatim, unit and all — it never normalises into a number', () => {
    const out = rawExtractionToProjections([{ ...GOOD, metric: 'MRR', target_value: 'EUR 50K' }]);
    expect(out[0].targetValue).toBe('EUR 50K');
  });

  it('falls back to approx precision rather than claiming a precision the model did not give', () => {
    expect(rawExtractionToProjections([{ ...GOOD, date_precision: undefined }])[0].datePrecision).toBe('approx');
    expect(rawExtractionToProjections([{ ...GOOD, date_precision: 'nonsense' }])[0].datePrecision).toBe('approx');
  });

  it('returns an empty list for anything that is not an array of objects', () => {
    expect(rawExtractionToProjections(undefined)).toEqual([]);
    expect(rawExtractionToProjections('1,000 users by Q2')).toEqual([]);
    expect(rawExtractionToProjections([null, 'x', 42])).toEqual([]);
  });

  it('bounds the list — a malformed response cannot flood the roadmap prompt', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...GOOD, metric: `metric ${i}` }));
    expect(rawExtractionToProjections(many)).toHaveLength(12);
  });

  it('keeps only the valid entries when a list mixes good and bad', () => {
    const out = rawExtractionToProjections([{ ...GOOD, target_date: 'Q2 2027' }, GOOD]);
    expect(out).toHaveLength(1);
    expect(out[0].metric).toBe('new users');
  });
});

describe('rawExtractionToData wiring', () => {
  it('carries projections through alongside the existing fields', () => {
    const data = rawExtractionToData({ document_type: 'pitch deck', projections: [GOOD] }, 5, 5);
    expect(data.projections).toHaveLength(1);
    expect(data.projections[0].targetDate).toBe('2027-04-01');
  });

  it('is an empty list, never undefined, for a document that projects nothing', () => {
    expect(rawExtractionToData({ document_type: 'grant agreement' }, 1, 1).projections).toEqual([]);
  });

  it('is NOT gated on document type, unlike the round block', () => {
    // A projection can legitimately appear in a business plan, a board
    // update or an investor report — none of which are "fundraising
    // material" in the round block's narrower sense. The guardrail here is
    // the metric+value+date requirement, not the document's label.
    const data = rawExtractionToData({ document_type: 'board update', projections: [GOOD] }, 1, 1);
    expect(data.projections).toHaveLength(1);
  });

  it('never asks the model for projections as a required field', () => {
    expect(EXTRACTION_TOOL_SCHEMA.required).not.toContain('projections');
    expect(Object.keys(EXTRACTION_TOOL_SCHEMA.properties)).toContain('projections');
  });
});
