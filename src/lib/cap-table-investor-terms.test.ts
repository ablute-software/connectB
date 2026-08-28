import { describe, expect, it } from 'vitest';
import { rawInvestorTermsToResult } from './cap-table-investor-terms';

describe('rawInvestorTermsToResult — Prompt 432 §E', () => {
  it('parses a well-formed date-trigger result', () => {
    const raw = {
      label: 'Seed Fund I', pct: 8, conversionTriggerType: 'date', conversionDate: '2027-04-01',
      conversionEvent: null, sourceNote: 'p.2, SAFE terms',
    };
    expect(rawInvestorTermsToResult(raw)).toEqual({
      label: 'Seed Fund I', pct: 8, conversionTriggerType: 'date', conversionDate: '2027-04-01',
      conversionEvent: null, sourceNote: 'p.2, SAFE terms',
    });
  });

  it('parses a well-formed event-trigger result', () => {
    const raw = {
      label: 'Angel Investor', pct: null, conversionTriggerType: 'event', conversionDate: null,
      conversionEvent: 'next priced round', sourceNote: null,
    };
    expect(rawInvestorTermsToResult(raw)).toEqual({
      label: 'Angel Investor', pct: null, conversionTriggerType: 'event', conversionDate: null,
      conversionEvent: 'next priced round', sourceNote: null,
    });
  });

  it('the correct, expected answer for a document with no fixed terms yet: everything null, not a failure', () => {
    const raw = { label: null, pct: null, conversionTriggerType: null, conversionDate: null, conversionEvent: null, sourceNote: null };
    expect(rawInvestorTermsToResult(raw)).toEqual({
      label: null, pct: null, conversionTriggerType: null, conversionDate: null, conversionEvent: null, sourceNote: null,
    });
  });

  it('clamps an out-of-range pct into 0-100', () => {
    expect(rawInvestorTermsToResult({ label: 'X', pct: 150 }).pct).toBe(100);
    expect(rawInvestorTermsToResult({ label: 'X', pct: -5 }).pct).toBe(0);
  });

  it('drops a non-numeric pct to null rather than coercing it', () => {
    expect(rawInvestorTermsToResult({ label: 'X', pct: '8%' }).pct).toBeNull();
  });

  it('drops a non-ISO conversionDate to null', () => {
    const result = rawInvestorTermsToResult({ conversionDate: 'April 2027' });
    expect(result.conversionDate).toBeNull();
    expect(result.conversionTriggerType).toBeNull();
  });

  it('never trusts the model\'s own conversionTriggerType field — derives it from whichever of date/event is actually populated', () => {
    // Model claims 'event' but only supplied a date — the real signal wins.
    const result = rawInvestorTermsToResult({ conversionTriggerType: 'event', conversionDate: '2026-10-01', conversionEvent: null });
    expect(result.conversionTriggerType).toBe('date');
    expect(result.conversionDate).toBe('2026-10-01');
  });

  it('resolves a dual-populated date+event deterministically (date wins) rather than keeping an invalid combination', () => {
    const result = rawInvestorTermsToResult({ conversionDate: '2026-10-01', conversionEvent: 'Series A close' });
    expect(result.conversionTriggerType).toBe('date');
    expect(result.conversionDate).toBe('2026-10-01');
    expect(result.conversionEvent).toBeNull();
  });

  it('trims label and sourceNote, and treats a blank string as null', () => {
    expect(rawInvestorTermsToResult({ label: '  Seed Fund I  ' }).label).toBe('Seed Fund I');
    expect(rawInvestorTermsToResult({ label: '   ' }).label).toBeNull();
    expect(rawInvestorTermsToResult({ sourceNote: '   ' }).sourceNote).toBeNull();
  });

  it('is resilient to null, undefined, or a non-object raw value', () => {
    const empty = { label: null, pct: null, conversionTriggerType: null, conversionDate: null, conversionEvent: null, sourceNote: null };
    expect(rawInvestorTermsToResult(null)).toEqual(empty);
    expect(rawInvestorTermsToResult(undefined)).toEqual(empty);
    expect(rawInvestorTermsToResult('not an object')).toEqual(empty);
  });
});
