import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeReconciliationSignature, reconcileGapCandidates, type ReconcilableDocument } from './reconciliation';
import type { CompanyClaim } from './types';

function claim(overrides: Partial<CompanyClaim> = {}): CompanyClaim {
  return {
    id: 'claim-1', category: 'validacao_externa', statement: 'Received the WomenTechEU award.',
    evidenceClass: 5, specificity: 'high', sourceKind: 'founder_answer', status: 'accepted',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function doc(overrides: Partial<ReconcilableDocument> = {}): ReconcilableDocument {
  return {
    id: 'doc-1', name: 'Woman In Tech Agreement.pdf', folderName: null,
    extraction: null, extractionUpdatedAt: null,
    ...overrides,
  };
}

// Prompt 461 — the one thing this signature exists to catch: a document
// re-extracted in place (same id, same name) must invalidate the cache even
// though nothing else about it changed. Before §A/§B, extractionUpdatedAt
// was always null (the query silently failed), so this axis never actually
// moved the signature in production.
describe('computeReconciliationSignature', () => {
  it('is deterministic for the same inputs', () => {
    const claims = [claim()];
    const docs = [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })];
    expect(computeReconciliationSignature(claims, docs)).toBe(computeReconciliationSignature(claims, docs));
  });

  it('changes when a document\'s extractionUpdatedAt changes, even with the same name and extraction presence', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })]);
    const after = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-02T00:00:00Z' })]);
    expect(before).not.toBe(after);
  });

  it('changes when a document is renamed, even though nothing about its extraction changed — the fixture this engine exists for', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ name: 'Contract.pdf' })]);
    const after = computeReconciliationSignature(claims, [doc({ name: 'Woman In Tech Agreement.pdf' })]);
    expect(before).not.toBe(after);
  });

  it('changes when extraction presence toggles from absent to present', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ extraction: null, extractionUpdatedAt: null })]);
    const after = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })]);
    expect(before).not.toBe(after);
  });

  it('changes when a claim\'s updatedAt changes', () => {
    const docs = [doc()];
    const before = computeReconciliationSignature([claim({ updatedAt: '2026-01-01T00:00:00Z' })], docs);
    const after = computeReconciliationSignature([claim({ updatedAt: '2026-01-02T00:00:00Z' })], docs);
    expect(before).not.toBe(after);
  });

  it('is order-independent for both claims and documents', () => {
    const a = claim({ id: 'claim-a' });
    const b = claim({ id: 'claim-b' });
    const docA = doc({ id: 'doc-a' });
    const docB = doc({ id: 'doc-b' });
    expect(computeReconciliationSignature([a, b], [docA, docB])).toBe(computeReconciliationSignature([b, a], [docB, docA]));
  });
});

// Prompt 465 §F — three properties this engine depends on, proven rather
// than assumed. Same hand-rolled fake-SupabaseClient pattern as
// network-db.test.ts: reconcileGapCandidates is exercised directly
// (candidates/documents passed in explicitly), never through
// runReconciliationForOrg's own derivation — that keeps these tests about
// the engine's own orchestration, not company-gaps.ts's rule logic.
function makeFakeAdmin(opts: {
  existingRows?: { claim_id: string; run_hash: string; status: string }[];
  upsertShouldThrowOnCall?: number; // 1-based
} = {}) {
  const upserts: Record<string, unknown>[] = [];
  let upsertCallCount = 0;
  const admin = {
    from: (table: string) => {
      if (table !== 'gap_reconciliations') throw new Error(`unexpected table in this fixture: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: opts.existingRows ?? [], error: null }),
          }),
        }),
        upsert: (payload: Record<string, unknown>) => {
          upsertCallCount++;
          // Simulates the instance dying mid-write — the closest a
          // synchronous mock can get to "a Vercel timeout landed exactly
          // here", which is the real event F.1 needs to survive.
          if (opts.upsertShouldThrowOnCall === upsertCallCount) throw new Error(`simulated interruption at upsert #${upsertCallCount}`);
          upserts.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc: () => Promise.resolve({ error: null }),
  } as unknown as SupabaseClient;
  return { admin, upserts };
}

// Reads the claim_ids the model was actually asked about out of the real
// request body (callReconciliationModel's own userText embeds
// `claim_id="..."` per claim) — never re-derives verdict logic, just
// answers on behalf of the model for whichever claims were actually sent.
function stubReconciliationFetch(verdictFor: (claimId: string) => { confidence: 'high' | 'medium' | 'none'; matchedDocumentId?: string }) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const parsed = JSON.parse(init.body) as { messages: { content: string }[] };
    const text = parsed.messages[0].content;
    const claimIds = [...text.matchAll(/claim_id="([^"]+)"/g)].map((m) => m[1]);
    const matches = claimIds.map((claim_id) => {
      const v = verdictFor(claim_id);
      return { claim_id, confidence: v.confidence, matched_document_id: v.matchedDocumentId ?? '', evidence_quote: '', reasoning: 'test verdict' };
    });
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { matches } }], usage: { input_tokens: 10, output_tokens: 10 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('reconcileGapCandidates — F.1 resume after a mid-run interruption', () => {
  it('a cutoff partway through the claim loop leaves the rest undone, and the NEXT run only retries those — never re-does what already landed', async () => {
    const claims = [claim({ id: 'claim-A', statement: 'A statement' }), claim({ id: 'claim-B', statement: 'B statement' }), claim({ id: 'claim-C', statement: 'C statement' })];
    const documents = [doc({ id: 'doc-1', name: 'Some Document.pdf' })];
    const signature = computeReconciliationSignature(claims, documents);
    stubReconciliationFetch(() => ({ confidence: 'none' }));

    // Run 1 — interrupted right after claim A's own row is written (the
    // 2nd upsert call, for claim B, throws): run_hash is written PER CLAIM,
    // inside the loop, after that claim's own verdict — never once at the
    // start or the end — so this is exactly where a real timeout would land.
    const { admin: admin1, upserts: upserts1 } = makeFakeAdmin({ existingRows: [], upsertShouldThrowOnCall: 2 });
    await expect(reconcileGapCandidates(admin1, 'fake-key', 'org-1', claims, documents)).rejects.toThrow();
    expect(upserts1.map((u) => u.claim_id)).toEqual(['claim-A']); // only the first claim's write actually landed

    // Run 2 — the real post-crash state: claim-A already has a
    // gap_reconciliations row at THIS signature; claim-B and claim-C do not.
    const { admin: admin2, upserts: upserts2 } = makeFakeAdmin({
      existingRows: [{ claim_id: 'claim-A', run_hash: signature, status: 'uncovered' }],
    });
    const outcome = await reconcileGapCandidates(admin2, 'fake-key', 'org-1', claims, documents);
    expect(outcome.ran).toBe(true);
    // Resumes exactly where it left off — B and C, never A again.
    expect(upserts2.map((u) => u.claim_id).sort()).toEqual(['claim-B', 'claim-C']);
  });
});

describe('reconcileGapCandidates — F.2 sequential idempotency', () => {
  it('a second run with the same signature returns ran:false and makes zero new model calls', async () => {
    const claims = [claim({ id: 'claim-X', statement: 'X statement' })];
    const documents = [doc()];
    const signature = computeReconciliationSignature(claims, documents);
    const fetchMock = stubReconciliationFetch(() => ({ confidence: 'none' }));

    const { admin: admin1 } = makeFakeAdmin({ existingRows: [] });
    const first = await reconcileGapCandidates(admin1, 'fake-key', 'org-1', claims, documents);
    expect(first.ran).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same claim, same documents, same signature — the real state after run 1.
    const { admin: admin2 } = makeFakeAdmin({ existingRows: [{ claim_id: 'claim-X', run_hash: signature, status: 'uncovered' }] });
    const second = await reconcileGapCandidates(admin2, 'fake-key', 'org-1', claims, documents);
    expect(second).toEqual({ ran: false, costEur: 0, autoLinked: 0, suggested: 0, uncovered: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // still just run 1's call — no new one
  });
});

describe('reconcileGapCandidates — F.3 concurrency: the gap this prompt does NOT close', () => {
  it('two overlapping runs against the SAME org+signature BOTH call the model and BOTH pay — a known, accepted, double-cost-only gap', async () => {
    // Prompt 465's own "Decisão de desenho": needsRun is computed from
    // gap_reconciliations BEFORE the model call, and each claim's run_hash
    // is only written AFTER that claim's own verdict — so two overlapping
    // runs against the same org (a browser tab and the 9am cron, or two
    // tabs of the same founder) both read the SAME pre-run state and both
    // pay. This is deliberately NOT a test pretending only one call
    // happens — it asserts the REAL, current, double-cost behavior on
    // purpose, so that whoever eventually builds the fix (an org-level
    // pg_try_advisory_xact_lock — needs a migration, its own future prompt,
    // not built here) has to come back and change THIS assertion instead
    // of the gap quietly reappearing unnoticed. Final state still
    // converges correctly even without a lock: the write is an upsert
    // keyed by claim_id, so run 2's write simply overwrites run 1's with
    // the same signature — genuinely nothing but the extra call is lost.
    const claims = [claim({ id: 'claim-Y', statement: 'Y statement' })];
    const documents = [doc()];
    const fetchMock = stubReconciliationFetch(() => ({ confidence: 'none' }));
    const { admin } = makeFakeAdmin({ existingRows: [] }); // shared: neither run has written when both read

    const [first, second] = await Promise.all([
      reconcileGapCandidates(admin, 'fake-key', 'org-1', claims, documents),
      reconcileGapCandidates(admin, 'fake-key', 'org-1', claims, documents),
    ]);

    expect(first.ran).toBe(true);
    expect(second.ran).toBe(true);
    // The day a lock exists, this drops to 1 — and this line must be
    // edited on purpose, not left to silently start failing.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Task D2 (docs/execution-queue.md) — "um teste que prove que a
// blueprint/reconcile já não tem um caminho de reconciliação próprio."
//
// Source-level, like no-fire-and-forget.test.ts and for the same reason:
// what is being asserted is a property of the FILE (does this route still
// carry its own copy of the mechanism?), which no runtime test of the
// handler can answer — a duplicated implementation and a delegating one
// both return a valid response.
//
// Prompt 465 replaced two dead fire-and-forget triggers with ONE awaited
// entry point, /api/reconciliation/run. /api/blueprint/reconcile was left
// as a second path to the same operation, and that route's own header
// recorded the overlap as a known debt. Two paths to the same work is how
// 465 came about in the first place: one of them drifts, and the one that
// drifts is the one nobody is looking at.
describe('reconciliation has exactly one implementation (task D2)', () => {
  const reconcileRoute = readFileSync(
    join(process.cwd(), 'src/app/api/blueprint/reconcile/route.ts'), 'utf8',
  );

  // Full-line comments stripped before asserting absence — the same known
  // false positive no-fire-and-forget.test.ts documents, and this test hit
  // it immediately: that route's header explains what it USED to call, in
  // prose, and a raw substring check counts the explanation as the thing
  // it is explaining. The assertion is about the code path, not the words.
  const reconcileCode = reconcileRoute
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('blueprint/reconcile no longer calls runReconciliationForOrg itself', () => {
    expect(reconcileCode).not.toContain('runReconciliationForOrg');
  });

  it('blueprint/reconcile delegates to the single mechanism instead', () => {
    expect(reconcileRoute).toContain('@/app/api/reconciliation/run/route');
    expect(reconcileRoute).toMatch(/return\s+reconciliationRun\(/);
  });

  it('blueprint/reconcile re-declares maxDuration — Next route config is not inherited through an imported handler', () => {
    expect(reconcileRoute).toMatch(/export const maxDuration = 60/);
  });

  it('/api/reconciliation/run is still the one that owns the mechanism', () => {
    const runRoute = readFileSync(
      join(process.cwd(), 'src/app/api/reconciliation/run/route.ts'), 'utf8',
    );
    expect(runRoute).toContain('runReconciliationForOrg');
    // The protections the delegating route now inherits rather than
    // duplicating. If any of these disappears from here, it disappears for
    // BOTH callers at once — which is the point of consolidating, and the
    // reason this assertion lives next to the one above.
    expect(runRoute).toContain('assertNotViewer');
    expect(runRoute).toContain('gapReconciliationsAvailable');
  });
});
