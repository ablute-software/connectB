// Prompt 370 — pure tests for the market-document-extraction parser.
import { describe, expect, it } from 'vitest';
import { parseMarketExtractionRaw, type MarketDocRef } from './market-document-extract';

const DOCS = new Map<number, MarketDocRef>([
  [1, { id: 'doc-pitch', name: 'Pitch deck.pdf' }],
  [2, { id: 'doc-sizing', name: 'Market_Sizing.pdf' }],
]);

describe('parseMarketExtractionRaw', () => {
  it('accepts a market_size item with a real document+page', () => {
    const raw = { market_size: [{ value: 2_000_000_000, currency: 'EUR', scope: 'TAM Europe', year: 2025, document_index: 2, page: 4 }] };
    const items = parseMarketExtractionRaw(raw, DOCS);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ section: 'sizing', documentId: 'doc-sizing', page: 4 });
    expect(items[0].structured).toMatchObject({ valueEur: 2_000_000_000, scope: 'TAM Europe', year: 2025 });
  });

  it('rejects an item with no document_index — never a fact without a source document', () => {
    const raw = { market_size: [{ value: 1, scope: 'TAM', page: 1 }] };
    expect(parseMarketExtractionRaw(raw, DOCS)).toEqual([]);
  });

  it('rejects an item whose document_index does not resolve to a known document', () => {
    const raw = { growth: [{ pct: 20, document_index: 99, page: 1 }] };
    expect(parseMarketExtractionRaw(raw, DOCS)).toEqual([]);
  });

  it('rejects a market_size item missing a required numeric value', () => {
    const raw = { market_size: [{ scope: 'TAM', document_index: 1, page: 2 }] };
    expect(parseMarketExtractionRaw(raw, DOCS)).toEqual([]);
  });

  it('parses competitors with the optional descriptive fields', () => {
    const raw = { competitors: [{ name: 'Acme Corp', country: 'PT', stage: 'seed', document_index: 1, page: 12 }] };
    const items = parseMarketExtractionRaw(raw, DOCS);
    expect(items[0]).toMatchObject({ section: 'players', title: 'Competitor: Acme Corp', documentId: 'doc-pitch', page: 12 });
  });

  it('trends/regulatory items require both title and detail text', () => {
    const raw = { trends: [{ title: 'Only a title', document_index: 1, page: 3 }] };
    expect(parseMarketExtractionRaw(raw, DOCS)).toEqual([]);
  });

  it('an empty raw response produces no items', () => {
    expect(parseMarketExtractionRaw({}, DOCS)).toEqual([]);
    expect(parseMarketExtractionRaw(undefined, DOCS)).toEqual([]);
  });
});
