'use client';
// Prompt 541 §D — the Round tab's Vault-first affordances: the suggestion on
// an empty field, the conflict notice on a field the founder decided by
// hand, and the one-line pointer to the Vault when there is nothing to
// suggest from yet.
//
// Visual pattern copied from Prompt 459's Identity card (amber, inline,
// "Sherlock found this in {doc}", one "Use suggestion" click) rather than
// invented. What is deliberately NOT here: any "pick a document from your
// Vault" selector. That is the control Prompt 431 removed from the cap
// table because it showed dozens of unrelated documents and "não auxilia
// nada" — the whole point of this design is that the founder never chooses
// a document at all; the extraction already happened in the background.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  decideRoundField, roundValueKey,
  type RoundFieldCandidate, type RoundFieldDecision, type RoundFieldValue, type RoundSourceField,
} from '@/lib/round-field-precedence';

// The route's own per-field shape, imported rather than restated so the two
// sides of the wire cannot drift.
import type { RoundSuggestionField as RoundSuggestionFieldDto } from '@/lib/round-suggestion';
export type { RoundSuggestionFieldDto };

export interface RoundSuggestions {
  available: boolean;
  anyCandidate: boolean;
  fields: Partial<Record<RoundSourceField, RoundSuggestionFieldDto>>;
}

const EMPTY: RoundSuggestions = { available: false, anyCandidate: false, fields: {} };

export function useRoundSuggestions(): RoundSuggestions {
  const [state, setState] = useState<RoundSuggestions>(EMPTY);
  useEffect(() => {
    fetch('/api/company/round-suggestion')
      .then((r) => r.json())
      .then((body: { available?: boolean; anyCandidate?: boolean; fields?: RoundSuggestions['fields'] }) => {
        setState(body.available
          ? { available: true, anyCandidate: !!body.anyCandidate, fields: body.fields ?? {} }
          : EMPTY);
      })
      .catch(() => {});
  }, []);
  return state;
}

function toCandidate(dto: RoundSuggestionFieldDto | undefined): RoundFieldCandidate | undefined {
  if (!dto || roundValueKey(dto.candidate) == null) return undefined;
  return {
    value: dto.candidate,
    documentId: dto.candidateDocumentId ?? '',
    documentName: dto.candidateDocumentName ?? 'a document in your Vault',
    extractedAt: dto.candidateExtractedAt ?? '',
    page: dto.candidatePage ?? null,
  };
}

// The decision for one field, against the value CURRENTLY on screen — the
// live draft while editing, the saved value otherwise. Using the draft
// matters: a founder who types the document's number themselves should see
// the suggestion disappear immediately, not sit there contradicting nothing.
export function roundFieldDecision(
  suggestions: RoundSuggestions, field: RoundSourceField, currentValue: RoundFieldValue,
): RoundFieldDecision {
  const dto = suggestions.fields[field];
  if (!dto) return { kind: 'none' };
  return decideRoundField({
    current: currentValue,
    entry: dto.currentSource ? { source: dto.currentSource, dismissed_candidate: dto.dismissedCandidate } : undefined,
    candidate: toCandidate(dto),
  });
}

export function formatRoundValue(field: RoundSourceField, v: RoundFieldValue, instrumentLabel: (v: string) => string): string {
  if (v == null || (Array.isArray(v) && v.length === 0)) return '—';
  if (Array.isArray(v)) return v.map(instrumentLabel).join(', ');
  if (field === 'round_valuation_basis') return v === 'post_money' ? 'post-money' : 'pre-money';
  if (typeof v === 'number') return `€${v.toLocaleString('en-US')}`;
  return String(v);
}

// One field's hint. Renders nothing at all in the common case — a card where
// every field agrees with the Vault looks exactly as it does today.
export function RoundFieldHint({ decision, field, instrumentLabel, onUse, onKeepOwn }: {
  decision: RoundFieldDecision;
  field: RoundSourceField;
  instrumentLabel: (v: string) => string;
  onUse: (value: RoundFieldValue, candidate: RoundFieldCandidate) => void;
  onKeepOwn: (candidate: RoundFieldCandidate) => void;
}) {
  if (decision.kind === 'none') return null;

  if (decision.kind === 'suggest') {
    const { candidate, replacesDocumentValue } = decision;
    return (
      <p className="mt-1 text-[11px] text-amber-700">
        <button type="button" onClick={() => onUse(candidate.value, candidate)} className="font-medium underline">
          Use {formatRoundValue(field, candidate.value, instrumentLabel)}
        </button>
        <span className="mt-0.5 block text-amber-600">
          Sherlock {replacesDocumentValue ? 'found a newer value' : 'found this'} in {candidate.documentName}
          {candidate.page != null ? `, page ${candidate.page}` : ''}.
        </span>
      </p>
    );
  }

  // §C.2 — both values, side by side, and the founder chooses. Non-blocking
  // on purpose: it never interrupts a save, never disables the input, and
  // "Keep mine" is remembered so the same question is not asked again.
  const { current, candidate } = decision;
  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
      <p>Your Vault has a different value for this.</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <b>Yours:</b> {formatRoundValue(field, current, instrumentLabel)}{' '}
          <button type="button" onClick={() => onKeepOwn(candidate)} className="underline">Keep this</button>
        </span>
        <span>
          <b>{candidate.documentName}:</b> {formatRoundValue(field, candidate.value, instrumentLabel)}{' '}
          <button type="button" onClick={() => onUse(candidate.value, candidate)} className="underline">Use this</button>
        </span>
      </div>
    </div>
  );
}

// §D — shown only while NO round field has ever been extracted from any
// document in this Vault. Once one has, the line disappears for good: same
// "the card goes away when it stops being needed" rule as Prompt 517/540,
// and the same reason — a permanent nudge is furniture, not help.
export function RoundVaultPointer({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
      Have this in a pitch deck or term sheet?{' '}
      <Link href="/documents" className="font-medium text-[#0E7490] underline">Upload it to your Vault</Link>{' '}
      and Sherlock can fill this in for you.
    </p>
  );
}
