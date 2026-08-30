// Prompt 471 §A — parses the model's response for the founder-initiated,
// document-based Market Thesis suggestion pass (POST
// /api/market-thesis/suggest-from-documents). Pure parsing/validation, no
// AI call here — same split, and for the identical reason, as
// market-document-extract.ts's own parseMarketExtractionRaw: the model is
// NEVER trusted to name its own source document by id or name (that's
// exactly the kind of detail a model can misremember/invent). Every
// document sent to the model is announced by a 1-based document_index in
// the prompt text, the model must echo that index back per suggestion, and
// this function maps it back to the real document via a server-trusted
// lookup — a suggestion whose index doesn't resolve is dropped before it
// ever leaves the server, never surfaced as if a source existed.
//
// The "never overwrite a field the founder already filled in" rule
// (Prompt 471 §A point 4) is enforced HERE, not left to the client alone:
// MarketThesisSection.tsx's own `!thesis[key]?.trim()` guard is real too,
// but a server that already knows the founder's current thesis should
// never depend on the client re-deriving the same guarantee correctly a
// second time — the same fail-closed instinct as everything else in this
// codebase that touches founder-authored content.
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MARKET_THESIS_TEXT_FIELD_KEYS, MARKET_THESIS_TEXT_MAX, type MarketThesisTextFieldKey } from './market-thesis';
import { pickPortraitDocuments } from './market-portrait';

export interface ThesisDocRef { id: string; name: string }

export interface ThesisFieldSuggestion {
  value: string;
  documentId: string;
  documentName: string;
  page: number | null;
}

interface RawFieldSuggestion { field?: unknown; value?: unknown; document_index?: unknown; page?: unknown }
interface RawThesisSuggestExtraction { suggestions?: RawFieldSuggestion[] }

function isTextFieldKey(v: unknown): v is MarketThesisTextFieldKey {
  return typeof v === 'string' && (MARKET_THESIS_TEXT_FIELD_KEYS as readonly string[]).includes(v);
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// `existingThesis` is the founder's CURRENT thesis (whatever is already in
// org_market_thesis) — a field already filled in there is dropped before
// it is ever added to the result, regardless of what the documents say.
// Disagreement between the founder and a document is information, not an
// error to silently resolve (Prompt 471 §A point 4).
export function parseThesisDocumentSuggestions(
  raw: unknown,
  docsByIndex: Map<number, ThesisDocRef>,
  existingThesis: Partial<Record<MarketThesisTextFieldKey, string | null>>,
): Partial<Record<MarketThesisTextFieldKey, ThesisFieldSuggestion>> {
  const r = (raw ?? {}) as RawThesisSuggestExtraction;
  const out: Partial<Record<MarketThesisTextFieldKey, ThesisFieldSuggestion>> = {};

  // Array.isArray, not just `?? []`: a malformed tool response (the model
  // returning something other than an array here) must degrade to "no
  // suggestions", never throw — the founder's own thesis fields must never
  // become unreadable because of a bad model response.
  for (const item of Array.isArray(r.suggestions) ? r.suggestions : []) {
    if (!isTextFieldKey(item.field)) continue;
    if (out[item.field]) continue; // the first usable suggestion for a field wins
    if (existingThesis[item.field]?.trim()) continue; // never overwrite a founder-filled field

    const value = typeof item.value === 'string' ? item.value.trim().slice(0, MARKET_THESIS_TEXT_MAX) : '';
    if (!value) continue;

    const idx = num(item.document_index);
    if (idx === null) continue;
    const doc = docsByIndex.get(idx);
    if (!doc) continue;

    out[item.field] = { value, documentId: doc.id, documentName: doc.name, page: num(item.page) };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Prompt 473 — the automatic trigger, and the cost control that makes it
// safe. Prompt 471 put this pass behind a button on purpose: a paid model
// call must never fire from a page load. 473 reintroduces the automatic
// trigger, so everything below exists to make "fires once per document set"
// true rather than aspirational.

// The candidate document set, resolved the SAME way for both the
// eligibility check (GET /api/market-thesis) and the pass itself (POST
// /api/market-thesis/suggest-from-documents). Shared deliberately, not
// copy-pasted: if the two ever picked different documents, the signature
// computed when deciding "should this fire?" would never match the one
// written after it ran, and the automatic pass would re-fire on every
// single page load — the exact cost leak this whole section exists to
// prevent. One reader, one answer.
export async function readCandidateDocumentIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const [{ data: docRows }, { data: folderRows }] = await Promise.all([
    admin.from('documents').select('id, name, folder_id').eq('org_id', orgId),
    admin.from('folders').select('id, name').eq('org_id', orgId),
  ]);
  const folderNameById = new Map(((folderRows ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
  return pickPortraitDocuments(((docRows ?? []) as { id: string; name: string; folder_id: string | null }[])
    .map((d) => ({ id: d.id, name: d.name, folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? '' : '' })));
}

// A function of the document set, never of the clock — the same principle
// as computeExtractionSignature (market-document-extract.ts). Ids only, not
// names or content hashes: a rename that keeps a document in the candidate
// set doesn't change what the model would read, and re-firing a paid pass
// for a rename is exactly the cost this prompt is guarding. A rename that
// moves a document IN or OUT of the set (pickPortraitDocuments matches on
// name) does change the id list, so that case is still caught.
//
// Deliberately NOT versioned, unlike computeExtractionSignature's own
// PIPELINE_VERSION: a version constant here would be a lever that re-opens
// one paid automatic attempt for every org on the platform the moment
// someone edits it. Nothing is permanently blocked by leaving it out — the
// manual button always runs regardless of this signature.
export function computeDocumentSuggestSignature(documentIds: string[]): string {
  return createHash('sha256').update([...new Set(documentIds)].sort().join('|')).digest('hex');
}

// Prompt 473 §1 — "a tese incompleta (pelo menos um de
// MARKET_THESIS_TEXT_FIELD_KEYS vazio)", exactly as written. A null thesis
// (an org with no org_market_thesis row at all — 10 of 11 orgs in
// production) has every field empty, so it reads as incomplete, which is
// correct: it is the emptiest case there is.
export function isThesisIncomplete(thesis: Partial<Record<MarketThesisTextFieldKey, string | null>> | null): boolean {
  return MARKET_THESIS_TEXT_FIELD_KEYS.some((k) => !thesis?.[k]?.trim());
}

// The whole trigger decision in one pure place, so every clause is
// directly testable and the GET and the POST can reach the same verdict
// from the same inputs (the POST re-checks rather than trusting the client
// — a client can be reloaded, raced, or edited).
export function shouldAutoSuggestFromDocuments(input: {
  thesisIncomplete: boolean;
  candidateDocumentCount: number;
  currentSignature: string | null;
  storedSignature: string | null;
  markCapabilityAvailable: boolean;
}): boolean {
  // Fails CLOSED on the capability: with migration 0281 not yet applied
  // there is nowhere to record "already attempted", so an automatic pass
  // would re-fire on every reload forever. Off is the safe state — the
  // manual button is unaffected either way.
  if (!input.markCapabilityAvailable) return false;
  if (!input.thesisIncomplete) return false;
  // Zero candidate documents -> never fires, and never spends the call
  // (Prompt 473 §1). The honest "no documents" answer still exists for the
  // manual button, which reaches the route and gets it there.
  if (input.candidateDocumentCount === 0) return false;
  if (!input.currentSignature) return false;
  return input.currentSignature !== input.storedSignature;
}

// Prompt 473 §2 — "Grava a marca sempre que a passagem corre, sucesso ou
// 'not found' honesto." This function takes NO outcome parameter, which is
// how that property is guaranteed rather than remembered: it structurally
// cannot behave differently for a pass that found suggestions and one that
// honestly found none.
//
// Writes ONLY the two mark columns. Never `updated_at`, never `version`,
// never any content column — an automatic suggestion attempt is not a
// content revision, and `version` feeds both the hypotheses' thesis_version
// stamp and the market-research cache key, neither of which should move
// because a background pass ran.
//
// The insert path matters more than it looks: 10 of 11 production orgs have
// no org_market_thesis row at all, and those are precisely the orgs whose
// thesis is empty — i.e. exactly the ones the automatic trigger targets.
// With no row there is nowhere to record the attempt, so without this
// insert the pass would re-fire on every reload for almost the whole
// platform. `version: 0` is deliberate: it marks a placeholder row that has
// never held saved content, so the founder's first real save still lands on
// version 1 (nextMarketThesisVersion increments from 0), exactly as it does
// today for an org with no row. Inserting at the column default of 1 would
// silently push every such org's first save to version 2.
export async function recordDocumentSuggestAttempt(
  admin: SupabaseClient, orgId: string, signature: string, nowIso: string,
): Promise<void> {
  const mark = { document_suggest_auto_attempted_at: nowIso, document_suggest_auto_signature: signature };

  const { data: updated, error } = await admin.from('org_market_thesis').update(mark).eq('org_id', orgId).select('org_id');
  if (error) {
    // Never throws: losing the mark costs one repeated attempt, but
    // failing the founder's suggestions over a bookkeeping write would be
    // worse. Logged so a persistent failure (which WOULD be a real cost
    // leak) leaves a trace instead of being invisible.
    console.error('[market-thesis] recordDocumentSuggestAttempt: update failed', error.message);
    return;
  }
  if ((updated ?? []).length > 0) return;

  const { error: insertError } = await admin.from('org_market_thesis').insert({ org_id: orgId, version: 0, ...mark });
  if (insertError) console.error('[market-thesis] recordDocumentSuggestAttempt: insert failed', insertError.message);
}
