// Prompt 370 — pure tests for the market-document-extraction parser.
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { parseMarketExtractionRaw, computeExtractionSignature, type MarketDocRef } from './market-document-extract';

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

// Prompt 467 v3 §1/§1b (Nuno's review) — the confirmed bug: an unversioned,
// mode-blind signature meant a deck already processed under the pre-467
// pipeline would read as "already ran" forever, and (composed with §4's
// correct legacy fallback) could even burn the one-time cutover
// opportunity permanently the moment the migration lands. These tests
// prove the fix at the level that actually decides it: the DB-level
// "same signature -> same row -> cache hit" behavior (route.ts's own
// .eq('run_signature', signature) lookup) is a simple equality check whose
// correctness follows mechanically from these fingerprints being right —
// verified by route review, same as every other DB-dependent claim in this
// codebase that can't be exercised without a live Postgres.
describe('computeExtractionSignature — versioned + mode-aware (Prompt 467 v3 §1/§1b)', () => {
  it('differs between typed:off and typed:on for the SAME document set — this is what reopens the pass exactly once after cutover', () => {
    const off = computeExtractionSignature(['sha-a', 'sha-b'], false);
    const on = computeExtractionSignature(['sha-a', 'sha-b'], true);
    expect(off).not.toBe(on);
  });

  it('is stable across repeated calls in the SAME mode — idempotent, never repays', () => {
    expect(computeExtractionSignature(['sha-a'], true)).toBe(computeExtractionSignature(['sha-a'], true));
    expect(computeExtractionSignature(['sha-a'], false)).toBe(computeExtractionSignature(['sha-a'], false));
  });

  it('differs from a bare, unversioned hash of the same sha256 list — proves the version+mode are actually mixed in, not decorative', () => {
    const bare = createHash('sha256').update(['sha-a', 'sha-b'].join('|')).digest('hex');
    expect(computeExtractionSignature(['sha-a', 'sha-b'], true)).not.toBe(bare);
    expect(computeExtractionSignature(['sha-a', 'sha-b'], false)).not.toBe(bare);
  });

  it('is order-independent over the sha256 list', () => {
    expect(computeExtractionSignature(['a', 'b'], true)).toBe(computeExtractionSignature(['b', 'a'], true));
  });
});
