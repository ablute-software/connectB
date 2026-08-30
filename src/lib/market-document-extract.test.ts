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

// ---------------------------------------------------------------------------
// Prompt 478 — the competition classifier (449/450) never reached the
// document path. Measured in production on 30/08: 13 competitors, 0
// classified, and 10 of them created FROM DOCUMENTS after the classifier
// was already live. The cause was upstream of any bug — this route's tool
// schema simply never asked for the fields classifyCompetitor needs, so it
// was never called at all for a document-sourced candidate.
import { parseStructuredForSection } from './market-research-structured';

// Facets as they arrive from a DOCUMENT: state + note, and no sourceUrl,
// because a PDF has none. The same facets in the web path would carry a URL.
const DOC_FACETS = {
  problemOrJobOverlap: { state: 'MATCH', note: 'Both detect the same analyte at point of care.' },
  outcomeOverlap: { state: 'MATCH', note: 'Same clinical decision supported.' },
  substitutability: { state: 'MATCH', note: 'The deck lists them as the alternative buyers consider.' },
  userOrBuyerOverlap: { state: 'MATCH', note: 'Sold to the same hospital procurement teams.' },
  useContextOverlap: { state: 'PARTIAL', note: 'Theirs is lab-based, ours is bedside.' },
};

describe('document-sourced competitors are classified (Prompt 478)', () => {
  it('a document with the full facets produces a sherlockClassification', () => {
    const raw = {
      competitors: [{
        name: 'Acme Diagnostics', country: 'PT', stage: 'seed', document_index: 1, page: 7,
        candidateKind: 'COMPANY', candidateStage: 'commercial', relation: DOC_FACETS,
      }],
    };
    const items = parseMarketExtractionRaw(raw, DOCS);
    expect(items).toHaveLength(1);
    const s = items[0].structured as Record<string, unknown>;
    expect(s.sherlockClassification).toBe('DIRECT');
    expect(s.candidateKind).toBe('COMPANY');
    expect(s.candidateStage).toBe('commercial');
  });

  // The verification the prompt asks for by name: the document path must
  // reach the SAME verdict the web path would for the same evidence. Any
  // divergence here means a second classifier has been born by accident.
  it('reaches exactly the classification the WEB path reaches for the same facts', () => {
    const webFacets = Object.fromEntries(
      Object.entries(DOC_FACETS).map(([k, v]) => [k, { ...v, sourceUrl: 'https://example.com/evidence' }]),
    );
    const web = parseStructuredForSection('players', {
      company: 'Acme Diagnostics', candidateKind: 'COMPANY', candidateStage: 'commercial', relation: webFacets,
    }) as { sherlockClassification: string } | null;

    const doc = parseMarketExtractionRaw({
      competitors: [{
        name: 'Acme Diagnostics', document_index: 1,
        candidateKind: 'COMPANY', candidateStage: 'commercial', relation: DOC_FACETS,
      }],
    }, DOCS)[0].structured as Record<string, unknown>;

    expect(web?.sherlockClassification).toBe('DIRECT');
    expect(doc.sherlockClassification).toBe(web?.sherlockClassification);
  });

  it('carries the relation through, so the founder sees the evidence and not just the verdict', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{ name: 'Acme', document_index: 1, candidateKind: 'COMPANY', candidateStage: 'commercial', relation: DOC_FACETS }],
    }, DOCS);
    const relation = (items[0].structured as Record<string, unknown>).relation as Record<string, { state: string; note: string; sourceUrl: string | null }>;
    expect(relation.problemOrJobOverlap.state).toBe('MATCH');
    expect(relation.problemOrJobOverlap.note).toBe('Both detect the same analyte at point of care.');
    // sourceUrl stays null rather than being filled with something
    // URL-shaped that is not one — the citation is the document on the row.
    expect(relation.problemOrJobOverlap.sourceUrl).toBeNull();
  });

  it('a pre_commercial candidate classifies as EMERGING, exactly as the shared classifier decides', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{ name: 'Newco', document_index: 1, candidateKind: 'COMPANY', candidateStage: 'pre_commercial', relation: DOC_FACETS }],
    }, DOCS);
    expect((items[0].structured as Record<string, unknown>).sherlockClassification).toBe('EMERGING');
  });

  it('an incumbent behaviour (DO_NOTHING) classifies as STATUS_QUO, never as a product competitor', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{ name: 'No monitoring today', document_index: 1, candidateKind: 'DO_NOTHING', candidateStage: 'unknown', relation: DOC_FACETS }],
    }, DOCS);
    expect((items[0].structured as Record<string, unknown>).sherlockClassification).toBe('STATUS_QUO');
  });
});

describe('no regression for documents that do not support the facets (Prompt 478 §5)', () => {
  it('name/country/stage/note only still yields a usable item — just unclassified, exactly as today', () => {
    const raw = { competitors: [{ name: 'Acme Corp', country: 'PT', stage: 'seed', document_index: 1, page: 12 }] };
    const items = parseMarketExtractionRaw(raw, DOCS);
    expect(items[0]).toMatchObject({ section: 'players', title: 'Competitor: Acme Corp', documentId: 'doc-pitch', page: 12 });
    const s = items[0].structured as Record<string, unknown>;
    expect(s).toMatchObject({ name: 'Acme Corp', country: 'PT', stage: 'seed' });
    expect(s.sherlockClassification).toBeUndefined();
  });

  it('a relation whose facets are all UNKNOWN produces no classification rather than a fabricated one', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{
        name: 'Vague Co', document_index: 1, candidateKind: 'COMPANY', candidateStage: 'commercial',
        relation: { problemOrJobOverlap: { state: 'UNKNOWN' }, outcomeOverlap: { state: 'UNKNOWN' } },
      }],
    }, DOCS);
    expect((items[0].structured as Record<string, unknown>).sherlockClassification).toBeUndefined();
  });

  it('an invalid candidateKind is ignored rather than trusted — the enum is validated server-side', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{ name: 'X', document_index: 1, candidateKind: 'ARCH_NEMESIS', candidateStage: 'commercial', relation: DOC_FACETS }],
    }, DOCS);
    expect((items[0].structured as Record<string, unknown>).sherlockClassification).toBeUndefined();
  });

  it('the model can never supply the classification itself — a field it invents is ignored', () => {
    const items = parseMarketExtractionRaw({
      competitors: [{
        name: 'Acme', document_index: 1, candidateKind: 'COMPANY', candidateStage: 'commercial',
        relation: DOC_FACETS, sherlockClassification: 'NOT_COMPETITOR',
      }],
    }, DOCS);
    // classifyCompetitor's verdict, never the model's.
    expect((items[0].structured as Record<string, unknown>).sherlockClassification).toBe('DIRECT');
  });
});

describe('the web path is unchanged by Prompt 478', () => {
  it('a web facet with MATCH and no sourceUrl still regresses to UNKNOWN — documentBacked is opt-in only', () => {
    const web = parseStructuredForSection('players', {
      company: 'Acme', candidateKind: 'COMPANY', candidateStage: 'commercial',
      relation: DOC_FACETS, // no sourceUrls anywhere
    });
    // All five decisive facets regress to UNKNOWN, so the relation is
    // unusable and the whole item is rejected — exactly as before.
    expect(web).toBeNull();
  });
});
