// Prompt 313 §B — the I/O side of linking an extraction to claims: reads the
// org's existing claims, runs the pure matching functions from
// company-claims.ts against this one extraction's facts, and persists the
// result (document_refs updates, and — narrowly — new proposed claims). The
// pure matching logic itself lives in company-claims.ts, on purpose (that
// file's own header: classification is mechanical, testable in isolation,
// never mixed with database code).
//
// Runs on EVERY call to extractDocument, including a sha256 cache hit — this
// step itself is cheap (no Anthropic call), and idempotent by construction
// (a claim already linked to this exact document is skipped, never
// double-appended), so re-running it costs nothing and lets a later re-run
// pick up claims created after the original extraction.
//
// The write itself goes through link_claim_document_ref (migration 0208), a
// single atomic UPDATE, rather than a JS-side read-modify-write — two
// documents uploaded moments apart can both match the SAME claim, and two
// concurrent fire-and-forget extraction requests are a real, not
// hypothetical, pattern here (caught by adversarial review: a plain
// read-then-write silently lost one of the two refs when both writes raced).
//
// Known, accepted limitation: only runs at EXTRACTION time. A claim typed by
// the founder AFTER a document was already extracted never gets linked
// retroactively — there is no reactive "claim created → re-scan all past
// extractions" trigger. Out of scope here for the same reason Prompt 311 §C
// declined general semantic dedup: the real case this exists for (an
// existing claim, an existing already-uploaded document) is fully solved by
// the one-time backfill script, and building continuous reactive relinking
// for the general case is not what was asked.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExistingClaims } from './company-knowledge-db';
import { findDocumentLinkCandidate, proposeClaimFromDocumentFact } from './company-claims';
import { extractionToFacts, programFacts, type DocumentExtractionData } from './document-extraction';

export interface LinkOutcome { linked: number; proposed: number }

export async function linkExtractionToClaims(
  admin: SupabaseClient, orgId: string, documentId: string, documentName: string, extraction: DocumentExtractionData,
): Promise<LinkOutcome> {
  const claims = await readExistingClaims(admin, orgId);
  const live = claims.filter((c) => c.status !== 'rejected');

  const facts = extractionToFacts(extraction, documentId, documentName);
  let linked = 0;
  for (const claim of live) {
    const match = findDocumentLinkCandidate(claim, facts);
    if (!match) continue;
    // Fast-path skip using our own already-fetched snapshot (avoids an RPC
    // round-trip for the common case); link_claim_document_ref's own WHERE
    // clause is the real, race-proof guard — this is purely an optimization,
    // never load-bearing for correctness.
    const existingRefs = claim.documentRefs ?? [];
    if (existingRefs.some((r) => r.documentId === documentId)) continue;
    const { error } = await admin.rpc('link_claim_document_ref', { p_claim_id: claim.id, p_ref: match });
    if (!error) linked++;
  }

  let proposed = 0;
  for (const fact of programFacts(extraction, documentId, documentName)) {
    const candidate = proposeClaimFromDocumentFact(fact, live);
    if (!candidate) continue;
    const { error } = await admin.from('company_claims').insert({
      org_id: orgId, category: candidate.category, statement: candidate.statement,
      evidence_class: candidate.evidenceClass, specificity: candidate.specificity,
      source_kind: candidate.sourceKind, source_ref: candidate.sourceRef,
      status: 'proposed', document_refs: candidate.documentRefs,
    });
    if (!error) proposed++;
  }

  return { linked, proposed };
}
