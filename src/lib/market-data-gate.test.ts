import { describe, expect, it } from 'vitest';
import { checkMarketDataGate, marketDataEmptyState } from './market-data-gate';

const COMPLETE = { sectors: ['Digital Health'], stage: 'seed', oneLiner: 'We do X.' };

describe('checkMarketDataGate — Prompt 360 §A.3', () => {
  it('eligible when sectors/stage/one_liner are set and at least one document is extracted', () => {
    expect(checkMarketDataGate(COMPLETE, true, false).eligible).toBe(true);
  });

  it('eligible when sectors/stage/one_liner are set and at least one market/solution claim is accepted', () => {
    expect(checkMarketDataGate(COMPLETE, false, true).eligible).toBe(true);
  });

  it('not eligible with neither a document nor a market/solution claim', () => {
    const result = checkMarketDataGate(COMPLETE, false, false);
    expect(result.eligible).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual(['minimum_knowledge']);
  });

  it('lists every missing field, in order, for a completely empty org', () => {
    const result = checkMarketDataGate({ sectors: [], stage: null, oneLiner: '' }, false, false);
    expect(result.missing.map((m) => m.key)).toEqual(['sectors', 'stage', 'one_liner', 'minimum_knowledge']);
  });

  it('sectors: null and sectors: [] are treated identically', () => {
    expect(checkMarketDataGate({ ...COMPLETE, sectors: null }, true, false).eligible).toBe(false);
    expect(checkMarketDataGate({ ...COMPLETE, sectors: [] }, true, false).eligible).toBe(false);
  });
});

describe('marketDataEmptyState — Prompt 370 §B, the three honest states', () => {
  it('has_content whenever anything market-related was found, regardless of counts', () => {
    expect(marketDataEmptyState({ docsTotal: 10, docsExtracted: 0 }, 1)).toBe('has_content');
  });

  it('not_read — the exact false negative the founder caught: extracted=0 with real documents on file is NEVER "nothing found"', () => {
    expect(marketDataEmptyState({ docsTotal: 67, docsExtracted: 0 }, 0)).toBe('not_read');
  });

  it('nothing_found only once documents have actually been read', () => {
    expect(marketDataEmptyState({ docsTotal: 67, docsExtracted: 67 }, 0)).toBe('nothing_found');
  });

  it('no_documents when the Vault itself is empty', () => {
    expect(marketDataEmptyState({ docsTotal: 0, docsExtracted: 0 }, 0)).toBe('no_documents');
    expect(marketDataEmptyState(null, 0)).toBe('no_documents');
  });
});
