import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  writeMarketFact, computeEvidenceFingerprint, computeFactFingerprint, deriveVerificationStatus,
  type EvidenceInput, type ObservationInput,
} from './market-facts-db';
import { validateGrowthFact, type GrowthFact } from './market-fact-normalization';

// ---------------------------------------------------------------------------
// Fixtures

function growthFact(overrides: Partial<GrowthFact> = {}): GrowthFact {
  return validateGrowthFact({
    kind: 'growth',
    marketDefinition: 'Home diagnostics', geography: 'EU', metric: 'CAGR',
    estimateShape: 'point', value: 8, lowerBound: null, upperBound: null,
    periodStart: 2025, periodEnd: 2030,
    sourceRefs: [], observationIds: ['obs-1'],
    validation: { status: 'valid', missing: [], errors: [], flags: [] },
    hasPositiveIdentity: true,
    ...overrides,
  });
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    documentId: 'doc-1', page: 10, quote: 'Growth is expected at 8% CAGR.',
    sourceUrl: null, publishedAt: null,
    origin: 'founder_document', sourceKind: 'pitch_deck', retrievalMethod: 'vault_extraction',
    ...overrides,
  };
}

function observation(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return { evidence: evidence(), extractionRunId: 'run-1', rawCandidate: { pct: 8 }, legacyItemId: null, ...overrides };
}

// A minimal query-builder stub: any chain of .select()/.eq() lands on the
// SAME configured result, whether the caller terminates with .maybeSingle()
// or just awaits the chain directly (Supabase's own builder is itself
// thenable). Good enough to test writeMarketFact's OWN logic — it does not
// simulate Postgres filtering, same fidelity level as this codebase's
// existing network-db.test.ts fake.
function makeQuery(result: { data: unknown; error: unknown }) {
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

function makeFakeAdmin(opts: {
  existingFact?: { id: string } | null;
  existingObservations?: { market_evidence: { origin: string; document_id: string | null; source_url: string | null } | null }[];
  rpcResult?: { data: unknown; error: { message: string } | null };
} = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    from: (table: string) => {
      // Deliberately exposes ONLY select() for these two tables — never
      // insert/upsert — so a writeMarketFact regression that tried to write
      // here directly (bypassing the RPC) would throw in this test rather
      // than silently "working" against a fake that's too permissive. That
      // is what makes the atomicity test below meaningful: the only way
      // this fake lets ANY row-shaped mutation happen is through .rpc(...).
      if (table === 'market_facts') return { select: () => makeQuery({ data: opts.existingFact ?? null, error: null }) };
      if (table === 'market_fact_observations') return { select: () => makeQuery({ data: opts.existingObservations ?? [], error: null }) };
      throw new Error(`market-facts-db.test.ts fake: unexpected table "${table}"`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpcResult ?? { data: 'fact-id-1', error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, rpcCalls };
}

// ---------------------------------------------------------------------------
// Pure functions

describe('computeEvidenceFingerprint', () => {
  it('is identical for two readings of the same document+page+quote (evidence dedup)', () => {
    const a = computeEvidenceFingerprint({ documentId: 'doc-1', page: 10, quote: 'Growth is 8% CAGR.', sourceUrl: null });
    const b = computeEvidenceFingerprint({ documentId: 'doc-1', page: 10, quote: 'Growth is 8% CAGR.', sourceUrl: null });
    expect(a).toBe(b);
  });

  // The exact case v1 of Prompt 467 left passing as two separate rows.
  it('is identical for two readings of the same document+page with quote = null on both', () => {
    const a = computeEvidenceFingerprint({ documentId: 'doc-1', page: 10, quote: null, sourceUrl: null });
    const b = computeEvidenceFingerprint({ documentId: 'doc-1', page: 10, quote: null, sourceUrl: null });
    expect(a).toBe(b);
  });

  it('differs for a different page', () => {
    const a = computeEvidenceFingerprint({ documentId: 'doc-1', page: 10, quote: null, sourceUrl: null });
    const b = computeEvidenceFingerprint({ documentId: 'doc-1', page: 11, quote: null, sourceUrl: null });
    expect(a).not.toBe(b);
  });

  it('uses source_url|quote for web evidence (no document_id)', () => {
    const a = computeEvidenceFingerprint({ documentId: null, page: null, quote: 'X', sourceUrl: 'https://example.com/report' });
    const b = computeEvidenceFingerprint({ documentId: null, page: null, quote: 'X', sourceUrl: 'https://example.com/report' });
    const c = computeEvidenceFingerprint({ documentId: null, page: null, quote: 'X', sourceUrl: 'https://example.com/other' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('computeFactFingerprint — discrimination (Prompt 467 required test)', () => {
  it('8% and 12% in the same market/geography/period are two distinct fingerprints, not one', () => {
    const a = computeFactFingerprint(growthFact({ value: 8 }));
    const b = computeFactFingerprint(growthFact({ value: 12 }));
    expect(a).not.toBe(b);
  });

  it('is stable for the exact same fact reextracted again', () => {
    const a = computeFactFingerprint(growthFact());
    const b = computeFactFingerprint(growthFact());
    expect(a).toBe(b);
  });

  it('differs when marketDefinition differs, context otherwise identical', () => {
    const a = computeFactFingerprint(growthFact({ marketDefinition: 'Home diagnostics' }));
    const b = computeFactFingerprint(growthFact({ marketDefinition: 'Point-of-care diagnostics' }));
    expect(a).not.toBe(b);
  });
});

// Prompt 467 v3 §2 (Nuno's review) — the confirmed bug: missing context
// normalized to '', so two AMBIGUOUS facts from different documents
// fingerprinted identically and the DB's unique constraint merged them.
// market-fact-normalization.ts's groupKeyFor already refuses to treat
// "both null" as identity (hasPositiveIdentity: false on the result) —
// this is the fingerprint layer honoring that same refusal instead of
// undoing it.
describe('computeFactFingerprint — ambiguous singletons must not merge on empty context (Prompt 467 v3 §2)', () => {
  function ambiguousFact(sourceRefs: { documentId: string; page: number | null; quote: string | null }[]) {
    return growthFact({
      marketDefinition: null, geography: null, hasPositiveIdentity: false,
      value: 8, metric: 'annual', periodStart: null, periodEnd: null,
      validation: { status: 'incomplete', missing: ['marketDefinition', 'geography', 'period'], errors: [], flags: [] },
      sourceRefs,
    });
  }

  it('required fixture: two incomplete facts, same value/metric/shape, DIFFERENT evidence → two distinct fingerprints, never one', () => {
    const a = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: '8% annual growth' }]);
    const b = ambiguousFact([{ documentId: 'doc-b', page: 7, quote: '8% annual growth' }]);
    expect(computeFactFingerprint(a)).not.toBe(computeFactFingerprint(b));
  });

  it('required fixture: the SAME incomplete candidate with the SAME evidence, reprocessed → one fingerprint (idempotence survives the fix)', () => {
    const a = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: '8% annual growth' }]);
    const b = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: '8% annual growth' }]);
    expect(computeFactFingerprint(a)).toBe(computeFactFingerprint(b));
  });

  it('discriminates by document+page alone when quote is null on both sides', () => {
    const a = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: null }]);
    const b = ambiguousFact([{ documentId: 'doc-b', page: 3, quote: null }]);
    expect(computeFactFingerprint(a)).not.toBe(computeFactFingerprint(b));
  });

  it('a duplicated sourceRef cannot shift the fingerprint (Set, not array)', () => {
    const once = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: 'x' }]);
    const twice = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: 'x' }, { documentId: 'doc-a', page: 3, quote: 'x' }]);
    expect(computeFactFingerprint(once)).toBe(computeFactFingerprint(twice));
  });

  it('two ambiguous facts sharing evidence but hasPositiveIdentity mismatched with a real fact never collide with a real-identity fact fingerprinting the same value', () => {
    const ambiguous = ambiguousFact([{ documentId: 'doc-a', page: 3, quote: null }]);
    const real = growthFact({ value: 8, metric: 'annual', hasPositiveIdentity: true });
    expect(computeFactFingerprint(ambiguous)).not.toBe(computeFactFingerprint(real));
  });
});

describe('deriveVerificationStatus', () => {
  it('is founder_reported when every origin is founder_document', () => {
    expect(deriveVerificationStatus([
      { origin: 'founder_document', documentId: 'doc-1', sourceUrl: null },
      { origin: 'founder_document', documentId: 'doc-1', sourceUrl: null },
    ])).toBe('founder_reported');
  });

  it('is externally_sourced with exactly one external origin', () => {
    expect(deriveVerificationStatus([
      { origin: 'founder_document', documentId: 'doc-1', sourceUrl: null },
      { origin: 'sherlock_web', documentId: null, sourceUrl: 'https://example.com/a' },
    ])).toBe('externally_sourced');
  });

  it('is corroborated with two independent external sources (distinct URLs)', () => {
    expect(deriveVerificationStatus([
      { origin: 'sherlock_web', documentId: null, sourceUrl: 'https://example.com/a' },
      { origin: 'external_report', documentId: null, sourceUrl: 'https://example.com/b' },
    ])).toBe('corroborated');
  });

  it('stays externally_sourced for two READINGS of the SAME external source (not independent)', () => {
    expect(deriveVerificationStatus([
      { origin: 'sherlock_web', documentId: null, sourceUrl: 'https://example.com/a' },
      { origin: 'sherlock_web', documentId: null, sourceUrl: 'https://example.com/a' },
    ])).toBe('externally_sourced');
  });
});

// ---------------------------------------------------------------------------
// writeMarketFact — the chokepoint

describe('writeMarketFact', () => {
  it('rejects a fact with zero observations — never persists a fact with no answer to "why do we know this?"', async () => {
    const { admin } = makeFakeAdmin();
    await expect(writeMarketFact(admin, 'org-1', growthFact(), [])).rejects.toThrow(/at least one observation/);
  });

  it('makes exactly ONE mutating call (the RPC) — no separate insert/upsert exists in this function', async () => {
    const { admin, rpcCalls } = makeFakeAdmin();
    await writeMarketFact(admin, 'org-1', growthFact(), [observation()]);
    // The fake's from('market_facts')/from('market_fact_observations') expose
    // ONLY select() — if writeMarketFact tried to insert/upsert directly, it
    // would have thrown before reaching this assertion.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('write_market_fact');
  });

  it('passes the derived verification_status and computed fingerprints through to the RPC', async () => {
    const { admin, rpcCalls } = makeFakeAdmin();
    await writeMarketFact(admin, 'org-1', growthFact(), [observation()]);
    const args = rpcCalls[0].args;
    expect(args.p_verification_status).toBe('founder_reported');
    expect(args.p_fact_fingerprint).toBe(computeFactFingerprint(growthFact()));
    const obs = args.p_observations as Record<string, unknown>[];
    expect(obs[0].evidence_fingerprint).toBe(computeEvidenceFingerprint(evidence()));
  });

  it('revalidates the fact rather than trusting the caller\'s own validation field', async () => {
    const { admin, rpcCalls } = makeFakeAdmin();
    // Built WITHOUT going through the growthFact() helper's own
    // validateGrowthFact call, so this object's validation field really
    // does lie when it reaches writeMarketFact: periodStart > periodEnd is
    // a concrete contradiction validateGrowthFact always rechecks itself
    // (never taken from the incoming validation), while the claimed
    // validation says 'valid' with nothing wrong.
    const bad: GrowthFact = {
      kind: 'growth', marketDefinition: 'Home diagnostics', geography: 'EU', metric: 'CAGR',
      estimateShape: 'point', value: 8, lowerBound: null, upperBound: null,
      periodStart: 2030, periodEnd: 2025,
      sourceRefs: [], observationIds: ['obs-1'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] },
      hasPositiveIdentity: true,
    };
    await writeMarketFact(admin, 'org-1', bad, [observation()]);
    const validation = rpcCalls[0].args.p_validation as { status: string; errors: string[] };
    expect(validation.status).toBe('invalid');
    expect(validation.errors).toContain('periodStart > periodEnd');
  });

  it('upgrades verification_status when the fact already has founder_document evidence and this call adds an external one', async () => {
    const { admin, rpcCalls } = makeFakeAdmin({
      existingFact: { id: 'fact-1' },
      existingObservations: [{ market_evidence: { origin: 'founder_document', document_id: 'doc-1', source_url: null } }],
    });
    await writeMarketFact(admin, 'org-1', growthFact(), [
      observation({ evidence: evidence({ origin: 'sherlock_web', documentId: null, sourceUrl: 'https://example.com/a', sourceKind: 'market_report', retrievalMethod: 'web_fetch' }) }),
    ]);
    expect(rpcCalls[0].args.p_verification_status).toBe('externally_sourced');
  });

  describe('idempotence — the necessary condition for it (Prompt 467 required test)', () => {
    // Real row-count idempotence ("1 fact + 2 observations") is enforced by
    // migration 0279's unique(org_id, fact_type, fact_fingerprint) and
    // unique(org_id, evidence_fingerprint) constraints inside the RPC — a DB
    // guarantee this mock cannot exercise without live Postgres (verified by
    // migration review, same as every other constraint in this codebase).
    // What IS this function's own responsibility, and what this test proves,
    // is that processing the SAME candidate twice produces the SAME
    // fact_fingerprint and the SAME evidence_fingerprint both times — the
    // exact precondition those unique constraints need to actually collapse
    // the two calls into one fact row and one evidence row while still
    // inserting two (never-deduplicated) observation rows.
    it('two calls with equivalent fact + evidence content compute identical fingerprints', async () => {
      const { admin: admin1, rpcCalls: calls1 } = makeFakeAdmin();
      const { admin: admin2, rpcCalls: calls2 } = makeFakeAdmin();
      await writeMarketFact(admin1, 'org-1', growthFact(), [observation({ extractionRunId: 'run-1' })]);
      await writeMarketFact(admin2, 'org-1', growthFact(), [observation({ extractionRunId: 'run-2' })]);
      expect(calls1[0].args.p_fact_fingerprint).toBe(calls2[0].args.p_fact_fingerprint);
      const obs1 = calls1[0].args.p_observations as Record<string, unknown>[];
      const obs2 = calls2[0].args.p_observations as Record<string, unknown>[];
      expect(obs1[0].evidence_fingerprint).toBe(obs2[0].evidence_fingerprint);
      // extraction_run_id differs — this IS the audit trail: two distinct
      // observation rows are expected, never deduplicated.
      expect(obs1[0].extraction_run_id).not.toBe(obs2[0].extraction_run_id);
    });
  });

  describe('supersession — lineage only (Prompt 467 required test)', () => {
    it('passes legacy_item_id = null through untouched when the observation carries no lineage', async () => {
      const { admin, rpcCalls } = makeFakeAdmin();
      await writeMarketFact(admin, 'org-1', growthFact(), [observation({ legacyItemId: null })]);
      const obs = rpcCalls[0].args.p_observations as Record<string, unknown>[];
      expect(obs[0].legacy_item_id).toBeNull();
    });

    it('passes a real legacy_item_id through verbatim, never fabricating or dropping it', async () => {
      const { admin, rpcCalls } = makeFakeAdmin();
      await writeMarketFact(admin, 'org-1', growthFact(), [observation({ legacyItemId: 'legacy-row-1' })]);
      const obs = rpcCalls[0].args.p_observations as Record<string, unknown>[];
      expect(obs[0].legacy_item_id).toBe('legacy-row-1');
    });
  });

  describe('atomicity (Prompt 467 required test)', () => {
    it('an RPC-level failure throws and leaves no other mutating call attempted', async () => {
      const { admin, rpcCalls } = makeFakeAdmin({ rpcResult: { data: null, error: { message: 'evidence insert failed' } } });
      await expect(writeMarketFact(admin, 'org-1', growthFact(), [observation()])).rejects.toThrow(/evidence insert failed/);
      // The one call that WAS made is the RPC itself — real atomicity (no
      // market_fact left orphaned) is then a Postgres function-transaction
      // guarantee (an unhandled exception inside write_market_fact rolls
      // back everything it did, per ordinary plpgsql semantics — see
      // migration 0279's own header) — not something a JS-level mock can
      // observe, but there is structurally no SECOND call from this
      // function that could ever leave a partial write behind.
      expect(rpcCalls).toHaveLength(1);
    });
  });
});
