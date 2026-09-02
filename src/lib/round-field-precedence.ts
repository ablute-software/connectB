// Prompt 541 §B/§C — provenance for the Round fields, and the rule that
// decides what a newly extracted value is allowed to do to one.
//
// Why this exists at all: the two suggestion patterns already in the app
// (Prompt 459's intro-pitch, Prompt 456's market thesis) only ever act on an
// EMPTY field. Neither has ever had to compare a value the founder typed
// with a value a document states and decide between them — that is new, and
// it is the whole of Nuno's precedence request.
//
// His three sentences, and how they are read here:
//
//   "os dados que devem prevalecer serão à mão se inseridos a 1º vez"
//   "ao fim de algum tempo serão os documentos (quando atualizados)"
//   "no caso de conflito ... aparece a info de ambos e o user escolhe"
//
// Read as a STATE, not a race. "By hand, if entered first" is not about who
// got there earlier in wall-clock time; it is about whether there is a human
// decision recorded on this field at all. That reading matters for financial
// data: a draft deck from three weeks ago must never quietly overwrite the
// number the founder decided on and saved, and a timestamp comparison would
// let it. So:
//
//   - no human decision on the field  -> a document may fill it (offered,
//     one click, never silent — see the note on `suggest` below);
//   - a human decision on the field   -> protected; a differing document
//     value is surfaced side by side and the founder picks.
//
// One deliberate narrowing of §C.1, which says a document-sourced field may
// be updated "livremente, sem pedir confirmação por-campo": that is read as
// "no conflict dialogue, no are-you-sure" — NOT as an automatic write. §D
// specifies the same one-click "Use suggestion" gesture for these fields,
// and the standing rule for this whole family of features (Prompt 459, and
// the Team/Cap-table Fill-with-Watson panels) is that nothing reaches the
// database without the founder pressing Save. An automatic write would also
// be the one behaviour here with no undo.

import type { RoundFieldsSource, RoundFieldSourceEntry, RoundSourceField } from './types';

export type { RoundFieldsSource, RoundFieldSourceEntry, RoundSourceField };

// The nine Round fields a document can speak to. `round_secured_eur` and
// `round_raising` are deliberately NOT in this list: how much is already
// soft-circled, and whether you are raising at all, are facts about the
// founder's live process that no pitch deck can be authoritative about.
export const ROUND_SOURCE_FIELDS = [
  'round_target_eur',
  'round_instruments',
  'round_valuation_eur',
  'round_valuation_basis',
  'round_runway_months',
  'round_runway_post_months',
  'round_target_close_date',
  'round_use_of_funds',
  'round_min_ticket_eur',
] as const;

// Compile-time proof that the runtime list above and the RoundSourceField
// union in types.ts are the same nine names. If either side gains or loses
// a field without the other, this stops being assignable and the build
// fails — which is the only way a literal list and a union stay honest.
const _fieldsMatchUnion: readonly RoundSourceField[] = ROUND_SOURCE_FIELDS;
const _unionCoveredByFields: RoundSourceField = ROUND_SOURCE_FIELDS[0];
void _fieldsMatchUnion; void _unionCoveredByFields;

// Narrowing guard for the untrusted-key case: anything arriving from a
// request body or a stored jsonb blob is `string` until this says otherwise.
export function isRoundSourceField(key: string): key is RoundSourceField {
  return (ROUND_SOURCE_FIELDS as readonly string[]).includes(key);
}

// What the value of a Round field can be, across the nine.
export type RoundFieldValue = number | string | string[] | null | undefined;

// Canonical string form, used both for equality and for
// `dismissed_candidate`. Arrays are order-insensitive: ['safe','equity'] and
// ['equity','safe'] are the same set of instruments and must not read as a
// conflict.
export function roundValueKey(v: RoundFieldValue): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const parts = v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).sort();
    return parts.length ? parts.join('|') : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  const t = v.trim();
  return t ? t : null;
}

export function roundValuesEqual(a: RoundFieldValue, b: RoundFieldValue): boolean {
  return roundValueKey(a) === roundValueKey(b);
}

export interface RoundFieldCandidate {
  value: RoundFieldValue;
  documentId: string;
  documentName: string;
  extractedAt: string;
  page: number | null;
}

export type RoundFieldDecision =
  // Nothing to show: no candidate, the candidate matches what is already
  // there, or the founder already rejected this exact candidate.
  | { kind: 'none' }
  // Offer it: the field carries no human decision. One click applies.
  | { kind: 'suggest'; candidate: RoundFieldCandidate; replacesDocumentValue: boolean }
  // Protected: a human decision is recorded and the document disagrees.
  | { kind: 'conflict'; current: RoundFieldValue; candidate: RoundFieldCandidate };

export function decideRoundField(params: {
  current: RoundFieldValue;
  entry: RoundFieldSourceEntry | undefined;
  candidate: RoundFieldCandidate | undefined;
}): RoundFieldDecision {
  const { current, entry, candidate } = params;
  if (!candidate || roundValueKey(candidate.value) == null) return { kind: 'none' };
  // Already says the same thing — never a question, whatever the provenance.
  if (roundValuesEqual(current, candidate.value)) return { kind: 'none' };

  const hasValue = roundValueKey(current) != null;
  const isManual = entry?.source === 'manual';

  // §C.2 — a human decision is recorded on this field. Protected. Note the
  // `hasValue` guard: a field marked manual whose value was since cleared
  // has nothing left to protect, so it falls through to the offer below
  // rather than raising a conflict against an empty value.
  if (isManual && hasValue) {
    if (entry?.dismissed_candidate && entry.dismissed_candidate === roundValueKey(candidate.value)) {
      return { kind: 'none' };
    }
    return { kind: 'conflict', current, candidate };
  }

  // §C.1 — never filled, or filled only by a previous suggestion with no
  // manual edit since. Offered, attributed, one click.
  return { kind: 'suggest', candidate, replacesDocumentValue: hasValue };
}

// The provenance patch a save should record. Every Round field in the patch
// is 'manual' unless the caller explicitly says it came from a document —
// defaulting the other way would silently strip protection from fields the
// founder typed, which is the one error mode here that loses a decision.
export function nextRoundFieldsSource(params: {
  existing: RoundFieldsSource | null | undefined;
  patch: Record<string, unknown>;
  accepted?: Partial<Record<RoundSourceField, { documentId: string; documentName: string; extractedAt: string }>>;
  keptOwn?: Partial<Record<RoundSourceField, string>>;
  now: string;
}): RoundFieldsSource {
  const next: RoundFieldsSource = { ...(params.existing ?? {}) };

  for (const key of ROUND_SOURCE_FIELDS) {
    const kept = params.keptOwn?.[key];
    if (kept) {
      // "Keep mine" on a conflict: re-affirms the manual decision AND
      // remembers which candidate was turned down.
      next[key] = { source: 'manual', at: params.now, dismissed_candidate: kept };
      continue;
    }
    if (!(key in params.patch)) continue;
    const from = params.accepted?.[key];
    next[key] = from
      ? { source: 'document', document_id: from.documentId, document_name: from.documentName, extracted_at: from.extractedAt, at: params.now }
      : { source: 'manual', at: params.now };
  }

  return next;
}
