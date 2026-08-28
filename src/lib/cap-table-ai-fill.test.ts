import { describe, expect, it } from 'vitest';
import { rawCapTableFillToResult } from './cap-table-ai-fill';

const TODAY = '2026-08-28';

describe('rawCapTableFillToResult — Prompt 426 §B', () => {
  it('parses a well-formed entry, converting snake_case to camelCase', () => {
    const raw = { entries: [{ category: 'founder', label: 'Ana Silva', pct: 45, as_of: '2026-01-15', source_note: 'p.3, cap table summary' }] };
    const result = rawCapTableFillToResult(raw, TODAY);
    expect(result.entries).toEqual([{ category: 'founder', label: 'Ana Silva', pct: 45, asOf: '2026-01-15', sourceNote: 'p.3, cap table summary' }]);
  });

  it('defaults asOf to the injected today when the model omits it', () => {
    const raw = { entries: [{ category: 'option_pool', label: 'ESOP pool', pct: 10 }] };
    const result = rawCapTableFillToResult(raw, TODAY);
    expect(result.entries[0].asOf).toBe(TODAY);
  });

  it('defaults asOf to today when the model returns a non-ISO date', () => {
    const raw = { entries: [{ category: 'adviser', label: 'Jane Doe', pct: 2, as_of: 'January 2026' }] };
    const result = rawCapTableFillToResult(raw, TODAY);
    expect(result.entries[0].asOf).toBe(TODAY);
  });

  it('sourceNote is null when omitted or blank', () => {
    const raw = { entries: [
      { category: 'investor', label: 'Seed Fund I', pct: 15 },
      { category: 'investor', label: 'Seed Fund II', pct: 5, source_note: '   ' },
    ] };
    const result = rawCapTableFillToResult(raw, TODAY);
    expect(result.entries[0].sourceNote).toBeNull();
    expect(result.entries[1].sourceNote).toBeNull();
  });

  it('drops an entry with a category outside the closed CapTableEntry enum', () => {
    const raw = { entries: [{ category: 'employee', label: 'Someone', pct: 1 }] };
    expect(rawCapTableFillToResult(raw, TODAY).entries).toEqual([]);
  });

  it('drops an entry with a non-numeric pct', () => {
    const raw = { entries: [{ category: 'founder', label: 'Ana Silva', pct: '45%' }] };
    expect(rawCapTableFillToResult(raw, TODAY).entries).toEqual([]);
  });

  it('drops an entry with pct out of the 0-100 range — never trust an out-of-range figure', () => {
    const raw = { entries: [{ category: 'founder', label: 'A', pct: -5 }, { category: 'founder', label: 'B', pct: 150 }] };
    expect(rawCapTableFillToResult(raw, TODAY).entries).toEqual([]);
  });

  it('drops an entry with a missing or blank label', () => {
    const raw = { entries: [{ category: 'founder', pct: 50 }, { category: 'founder', label: '   ', pct: 50 }] };
    expect(rawCapTableFillToResult(raw, TODAY).entries).toEqual([]);
  });

  it('keeps valid entries alongside dropped invalid ones, never letting one bad row void the rest', () => {
    const raw = { entries: [
      { category: 'founder', label: 'Ana Silva', pct: 60 },
      { category: 'not_a_category', label: 'Bad row', pct: 10 },
      { category: 'option_pool', label: 'ESOP pool', pct: 15 },
    ] };
    const result = rawCapTableFillToResult(raw, TODAY);
    expect(result.entries.map((e) => e.label)).toEqual(['Ana Silva', 'ESOP pool']);
  });

  it('never estimates a breakdown — an empty/missing entries list stays empty, the documented "correct answer" case', () => {
    expect(rawCapTableFillToResult({ entries: [] }, TODAY).entries).toEqual([]);
    expect(rawCapTableFillToResult({}, TODAY).entries).toEqual([]);
    expect(rawCapTableFillToResult(null, TODAY).entries).toEqual([]);
    expect(rawCapTableFillToResult(undefined, TODAY).entries).toEqual([]);
  });

  it('is resilient to a non-array entries field', () => {
    expect(rawCapTableFillToResult({ entries: 'not an array' }, TODAY).entries).toEqual([]);
  });
});
