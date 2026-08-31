import { describe, expect, it } from 'vitest';
import { TYPED_PIPELINE_SECTIONS, isSupersededByTypedFacts } from './market-legacy-typed-items';

describe('isSupersededByTypedFacts — Prompt 488 §1', () => {
  it('hides the exact rows measured in production: document-sourced growth and sizing', () => {
    // 16 rows, one org, all created 29/08 before Prompt 467 landed.
    expect(isSupersededByTypedFacts({ section: 'growth', sourceKind: 'document' })).toBe(true);
    expect(isSupersededByTypedFacts({ section: 'sizing', sourceKind: 'document' })).toBe(true);
  });

  it('leaves the web research path completely alone', () => {
    // Measured the same day: 5 pending growth and 17 pending sizing rows
    // from source_kind='web'. Prompt 467 moved the DOCUMENT path only, so
    // these are current, not leftovers, and hiding them would be a
    // regression dressed as a cleanup.
    expect(isSupersededByTypedFacts({ section: 'growth', sourceKind: 'web' })).toBe(false);
    expect(isSupersededByTypedFacts({ section: 'sizing', sourceKind: 'web' })).toBe(false);
  });

  it('never touches the sections Prompt 467 did not move', () => {
    for (const section of ['players', 'segments', 'trends', 'regulatory', 'rounds', 'definition']) {
      expect(isSupersededByTypedFacts({ section, sourceKind: 'document' })).toBe(false);
    }
  });

  it('uses the section name the database actually allows', () => {
    // The DB CHECK permits 'sizing', never 'market_size' — the tool schema's
    // name for the same thing. Filtering on the tool's name would have
    // matched nothing at all and looked like it worked.
    expect(TYPED_PIPELINE_SECTIONS).toEqual(['growth', 'sizing']);
    expect(isSupersededByTypedFacts({ section: 'market_size', sourceKind: 'document' })).toBe(false);
  });

  it('a null source_kind is not a document', () => {
    expect(isSupersededByTypedFacts({ section: 'growth', sourceKind: null })).toBe(false);
  });
});
