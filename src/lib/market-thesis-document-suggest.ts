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
import { MARKET_THESIS_TEXT_FIELD_KEYS, MARKET_THESIS_TEXT_MAX, type MarketThesisTextFieldKey } from './market-thesis';

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
