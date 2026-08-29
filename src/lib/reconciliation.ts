// Prompt 358 Phase 2.1 — the reconciliation engine ("o cérebro"): before the
// founder is ever asked "is there a document for this?", the engine tries to
// answer that question itself from everything the app already knows.
//
// document-extraction-linking.ts already does a MECHANICAL version of this —
// but only at extraction time, and only by literal name/program overlap (its
// own header names both limits explicitly: "only runs at EXTRACTION time...
// no reactive claim-created -> re-scan-all-past-extractions trigger", and the
// match itself is company-claims.ts's findDocumentLinkCandidate, a substring
// match). Neither limitation is a bug in that file — it was built for a
// different moment (right after a document is read) and a different job
// (should THIS document also update THIS claim). This file is the
// retroactive, SEMANTIC counterpart Prompt 358 asks for: given the claims
// that would otherwise trigger a "is there a document?" question (G4), and
// EVERYTHING the app knows about the Vault (every document's name and, where
// available, its structured extraction), ask a model to judge evidence by
// MEANING, not string overlap. The acceptance fixture from Nuno's own broken
// session is the literal example in the system prompt below: a document
// renamed "Woman In Tech Agreement" backing a claim about a WomenTechEU
// award — no word in common, obviously the same fact to a human reader.
//
// Root privacy rule (CLAUDE.md) — verified before writing this: the two
// inputs are claims (already privacy-clean by construction — see
// company-knowledge.ts's own closed-list header) and Vault document
// names/extractions (also founder-authored/derived-from-founder-uploaded
// content, never platform performance). Nothing here reads interactions,
// passes, pipeline, or outreach data.
//
// Cached by a signature over exactly what could change the answer: which
// claims need reconciling (id+updatedAt) and which documents exist with what
// content (id+name+extraction presence+extraction updatedAt). A claim the
// founder already said "no, dismiss this match" for (status='dismissed')
// stays dismissed regardless of signature — that was a real founder answer,
// not a stale cache entry, and re-suggesting the same rejected match forever
// is exactly the infinite-reask bug Phase 1 exists to kill, just one layer
// up.
import 'server-only';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyClaim } from './types';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from './prompt-injection-defense';
import { logAiCall, computeCostEur } from './ai-cost-log';
import { providerErrorMessage } from './ai-provider-error';
import type { DocumentExtractionData } from './document-extraction';
import { readExistingClaims, hasAnyVaultDocument } from './company-knowledge-db';
import { ruleG4 } from './company-gaps';

export interface ReconcilableDocument {
  id: string;
  name: string;
  folderName: string | null;
  extraction: DocumentExtractionData | null;
  extractionUpdatedAt: string | null;
}

export async function readReconcilableDocuments(admin: SupabaseClient, orgId: string): Promise<ReconcilableDocument[]> {
  const [{ data: docs }, { data: folders }, { data: extractions, error: extractionsError }] = await Promise.all([
    admin.from('documents').select('id, name, folder_id').eq('org_id', orgId),
    admin.from('folders').select('id, name').eq('org_id', orgId),
    admin.from('document_extractions').select('document_id, extracted, updated_at, status').eq('org_id', orgId).eq('status', 'completed'),
  ]);
  // Prompt 461 §C — this exact query silently failed for as long as
  // document_extractions had no updated_at column (§A): the destructured
  // `{ data: extractions }` swallowed the error, extractionByDocId stayed
  // permanently empty, and every document got described to the model as
  // unanalyzed. Logged now so a future regression here (a renamed column, a
  // revoked grant) leaves a trace instead of failing the exact same way
  // silently — the rest of this function still degrades gracefully to an
  // empty extraction map, on purpose, so one bad query never blocks the
  // documents/folders half of this result.
  if (extractionsError) console.error('[reconciliation] readReconcilableDocuments: document_extractions query failed', extractionsError.message);
  const folderById = new Map((folders ?? []).map((f) => [f.id as string, (f.name as string | null) ?? null]));
  const extractionByDocId = new Map(
    (extractions ?? []).map((e) => [e.document_id as string, e as { extracted: unknown; updated_at: string | null }]),
  );
  return ((docs ?? []) as { id: string; name: string; folder_id: string | null }[]).map((d) => {
    const ext = extractionByDocId.get(d.id);
    return {
      id: d.id,
      name: d.name,
      folderName: d.folder_id ? folderById.get(d.folder_id) ?? null : null,
      extraction: ext ? (ext.extracted as DocumentExtractionData) : null,
      extractionUpdatedAt: ext?.updated_at ?? null,
    };
  });
}

// A rename changes NAME, which must invalidate the cache even though nothing
// about the extraction changed — the whole point of the fixture this engine
// exists for.
export function computeReconciliationSignature(candidates: CompanyClaim[], documents: ReconcilableDocument[]): string {
  const claimPart = candidates.map((c) => `${c.id}:${c.updatedAt ?? ''}`).sort().join(',');
  const docPart = documents
    .map((d) => `${d.id}:${d.name}:${d.extraction ? '1' : '0'}:${d.extractionUpdatedAt ?? ''}`)
    .sort().join(',');
  return createHash('sha256').update(`${claimPart}|${docPart}`).digest('hex');
}

function describeDocument(d: ReconcilableDocument): string {
  const parts = [`document_id="${d.id}", filename="${d.name}"${d.folderName ? ` (folder: ${d.folderName})` : ''}`];
  const e = d.extraction;
  if (!e) {
    parts.push('content not yet analyzed — filename is the only signal');
  } else {
    if (e.documentType) parts.push(`type: ${e.documentType}`);
    if (e.programs.length) parts.push(`programs/awards mentioned: ${e.programs.map((p) => p.name).join(', ')}`);
    if (e.namedEntities.length) parts.push(`named: ${e.namedEntities.map((n) => `${n.name} (${n.kind})`).join(', ')}`);
    if (e.dates.length) parts.push(`dates: ${e.dates.map((dt) => `${dt.label}: ${dt.date}`).join(', ')}`);
    if (e.amounts.length) parts.push(`amounts: ${e.amounts.map((a) => `${a.amount} ${a.currency}${a.label ? ` (${a.label})` : ''}`).join(', ')}`);
    if (e.documentReference) parts.push(`reference: ${e.documentReference}`);
    if (e.isSigned != null) parts.push(e.isSigned ? 'signed' : 'not signed');
  }
  return parts.join(' — ');
}

export interface ReconciliationModelVerdict {
  confidence: 'high' | 'medium' | 'none';
  matchedDocumentId: string | null;
  evidenceQuote: string | null;
  reasoning: string;
}

export async function callReconciliationModel(
  apiKey: string, model: string, orgId: string,
  candidates: CompanyClaim[], documents: ReconcilableDocument[],
): Promise<{ verdicts: Map<string, ReconciliationModelVerdict>; costEur: number }> {
  const claimsText = candidates.map((c) => `- claim_id="${c.id}" [${c.category}]: "${c.statement}"`).join('\n');
  const docsText = documents.map((d) => `- ${describeDocument(d)}`).join('\n');

  const system = 'You reconcile a startup founder\'s accepted claims against the documents already in their Vault, '
    + 'looking for a document that is genuine EVIDENCE for a claim — even when no word literally matches. '
    + 'Example: a claim "X received the WomenTechEU award" is well matched by a document the founder renamed to '
    + '"Woman In Tech Agreement", even though the person\'s name never appears in that filename — judge by MEANING, '
    + 'never by string overlap alone. '
    + 'confidence="high" only when you are genuinely confident the SAME specific fact (same person, program, contract, '
    + 'or amount) is what that document is about. confidence="medium" when there is a real but not certain connection — '
    + 'the founder should confirm it themselves before it counts as evidence. confidence="none" when nothing in the '
    + 'Vault genuinely relates to this claim. Never invent a connection to be helpful — false certainty is worse than '
    + 'admitting none was found. matched_document_id must be copied EXACTLY from one of the document_id values given, '
    + 'or an empty string when confidence is "none". Return exactly one verdict per claim given, in the same order. '
    + DOCUMENT_CONTENT_INSTRUCTION;

  const userText = `Claims needing document evidence:\n${wrapDocumentContent(claimsText)}\n\n`
    + `Documents available in the Vault:\n${wrapDocumentContent(docsText || '(no documents in the Vault yet)')}\n\n`
    + 'For EACH claim above, return your verdict.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: Math.min(4000, 300 + candidates.length * 200), system,
      messages: [{ role: 'user', content: userText }],
      tools: [{
        name: 'report_reconciliation',
        description: 'Return a verdict for every claim given.',
        input_schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  claim_id: { type: 'string' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'none'] },
                  matched_document_id: { type: 'string', description: 'Exact document_id from the list given, or empty string.' },
                  evidence_quote: { type: 'string', description: 'A short phrase from the document data supporting the match, or empty string.' },
                  reasoning: { type: 'string' },
                },
                required: ['claim_id', 'confidence', 'matched_document_id', 'reasoning'],
              },
            },
          },
          required: ['matches'],
        },
      }],
      tool_choice: { type: 'tool', name: 'report_reconciliation' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[reconciliation]', await res.text()));
  const data = await res.json();
  void logAiCall({ route: '/api/blueprint/reconcile', purpose: 'reconciliation', model, usage: data.usage, orgId });

  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  const raw = ((toolUse?.input as { matches?: unknown[] } | undefined)?.matches ?? []) as Record<string, unknown>[];
  const verdicts = new Map<string, ReconciliationModelVerdict>();
  for (const m of raw) {
    const claimId = typeof m.claim_id === 'string' ? m.claim_id : null;
    if (!claimId) continue;
    const confidence = m.confidence === 'high' || m.confidence === 'medium' ? m.confidence : 'none';
    const matchedDocumentId = typeof m.matched_document_id === 'string' && m.matched_document_id.trim() ? m.matched_document_id.trim() : null;
    const evidenceQuote = typeof m.evidence_quote === 'string' && m.evidence_quote.trim() ? m.evidence_quote.trim() : null;
    const reasoning = typeof m.reasoning === 'string' ? m.reasoning.trim() : '';
    verdicts.set(claimId, { confidence, matchedDocumentId, evidenceQuote, reasoning });
  }
  return { verdicts, costEur: computeCostEur(model, data.usage) };
}

export interface ReconcileOutcome {
  ran: boolean;
  costEur: number;
  autoLinked: number;
  suggested: number;
  uncovered: number;
}

// The orchestrator — called both on-demand (before /api/blueprint builds the
// question queue) and reactively (end of the extraction pipeline, and on
// document rename). `candidates` must be exactly the live, accepted claims
// that would otherwise generate a G4 question (ruleG4's own filter, reused
// rather than duplicated — see the call site in /api/blueprint/route.ts).
export async function reconcileGapCandidates(
  admin: SupabaseClient, apiKey: string | undefined, orgId: string,
  candidates: CompanyClaim[], documents: ReconcilableDocument[],
): Promise<ReconcileOutcome> {
  if (candidates.length === 0 || !apiKey) return { ran: false, costEur: 0, autoLinked: 0, suggested: 0, uncovered: 0 };

  const signature = computeReconciliationSignature(candidates, documents);

  const { data: existingRows } = await admin.from('gap_reconciliations')
    .select('claim_id, run_hash, status')
    .eq('org_id', orgId)
    .in('claim_id', candidates.map((c) => c.id));
  const existingByClaimId = new Map(
    (existingRows ?? []).map((r) => [r.claim_id as string, r as { run_hash: string; status: string }]),
  );

  const needsRun = candidates.filter((c) => {
    const row = existingByClaimId.get(c.id);
    if (!row) return true;
    if (row.status === 'dismissed') return false;
    return row.run_hash !== signature;
  });
  if (needsRun.length === 0) return { ran: false, costEur: 0, autoLinked: 0, suggested: 0, uncovered: 0 };

  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  let result: { verdicts: Map<string, ReconciliationModelVerdict>; costEur: number };
  try {
    result = await callReconciliationModel(apiKey, model, orgId, needsRun, documents);
  } catch (e) {
    console.error('[reconciliation] model call failed', (e as Error).message);
    return { ran: false, costEur: 0, autoLinked: 0, suggested: 0, uncovered: 0 };
  }

  let autoLinked = 0; let suggested = 0; let uncovered = 0;
  for (const claim of needsRun) {
    const v: ReconciliationModelVerdict = result.verdicts.get(claim.id)
      ?? { confidence: 'none', matchedDocumentId: null, evidenceQuote: null, reasoning: 'No verdict returned.' };

    let status: 'auto_linked' | 'suggested' | 'uncovered' = 'uncovered';
    if (v.confidence === 'high' && v.matchedDocumentId && documents.some((d) => d.id === v.matchedDocumentId)) {
      const doc = documents.find((d) => d.id === v.matchedDocumentId)!;
      const { error } = await admin.rpc('link_claim_document_ref', {
        p_claim_id: claim.id, p_ref: { documentId: doc.id, documentName: doc.name, page: null },
      });
      if (!error) { status = 'auto_linked'; autoLinked++; } else { status = 'suggested'; suggested++; }
    } else if (v.confidence === 'medium' && v.matchedDocumentId && documents.some((d) => d.id === v.matchedDocumentId)) {
      status = 'suggested'; suggested++;
    } else {
      status = 'uncovered'; uncovered++;
    }

    await admin.from('gap_reconciliations').upsert({
      org_id: orgId, claim_id: claim.id, run_hash: signature,
      confidence: v.confidence, matched_document_id: v.matchedDocumentId || null,
      evidence_quote: v.evidenceQuote || null, reasoning: v.reasoning || null, status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'claim_id' });
  }

  return { ran: true, costEur: result.costEur, autoLinked, suggested, uncovered };
}

// Prompt 358 Phase 2.1 — the single entry point every trigger (on-demand
// before /api/blueprint builds its question queue, end of the extraction
// pipeline, document rename) calls, so "candidates = exactly what ruleG4
// would flag" and "documents = readReconcilableDocuments" are computed
// identically everywhere rather than re-derived per call site. hasVaultDocuments
// only matters to ruleG4 for prova_tecnica's coarse fallback — always true
// here since every caller of this function runs precisely because the
// Vault's documents/claims may have changed.
export async function runReconciliationForOrg(
  admin: SupabaseClient, apiKey: string | undefined, orgId: string,
): Promise<ReconcileOutcome> {
  const [claims, hasVaultDocuments] = await Promise.all([
    readExistingClaims(admin, orgId),
    hasAnyVaultDocument(admin, orgId),
  ]);
  const live = claims.filter((c) => c.status !== 'rejected');
  const candidateIds = new Set(ruleG4(live, { founders: [], now: new Date(), hasVaultDocuments }).map((g) => g.relatedClaimIds[0]));
  const candidates = live.filter((c) => candidateIds.has(c.id));
  const documents = await readReconcilableDocuments(admin, orgId);
  return reconcileGapCandidates(admin, apiKey, orgId, candidates, documents);
}
