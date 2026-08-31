// Prompt 463 §B.3 — one sentence per ExtractionSkipReason, so a skipped
// document is always named and explained, never dropped in silence. No
// 'server-only': this is imported by MarketDataPanel.tsx (a client
// component) — only a type-only import from document-extraction-pipeline.ts
// below, erased at compile time, so the server-only boundary there is never
// crossed at runtime. Same already-established pattern as market-data-gate.ts,
// a pure function imported by both a client component and a server route.
//
// The switch has no default on purpose: with every ExtractionSkipReason
// literal covered and each case returning, TypeScript proves the function
// always returns a string — a future 10th reason with no case here fails
// tsc, not just a missed test. That's the "sem caminho silencioso" the
// prompt asks for, enforced at compile time, not only by the test below.
import type { ExtractionSkipReason } from './document-extraction-pipeline';

export function extractionSkipReasonMessage(reason: ExtractionSkipReason): string {
  switch (reason) {
    case 'scan_unavailable': return 'security scanning is not available right now';
    case 'not_found': return 'that document could not be found';
    case 'not_clean': return 'that document has not cleared its security scan yet';
    case 'not_pdf': return 'that document is not a PDF';
    case 'too_large': return 'that document is too large to read';
    case 'download_failed': return 'that document could not be downloaded';
    case 'pdf_parse_failed': return 'that PDF could not be opened';
    case 'claude_failed': return 'reading that document failed — try again';
    case 'link_unreadable': return 'that link did not return a readable file';
  }
}

// Prompt 482 — the other half of this screen's honesty: what the pass as a
// whole did. It lives here, not next to the upsert logic that produces the
// counts, because MarketDataPanel.tsx is a client component and that module
// is server-only (it takes an admin SupabaseClient) — the same boundary the
// header above describes.
//
// Before this prompt the panel said "Already read — nothing new in these
// documents." whenever itemsProposed was 0. That is the exact sentence Nuno
// saw three times while paying for three real model runs (€0.141, €0.091,
// €0.091): every proposal had collided with a row left behind by a
// different document and been discarded. Now that a pass can change
// something without inserting anything, "nothing new" has to mean nothing
// new.
//
// Prompt 483 §6 — extended, not duplicated: a pass can now also fill in the
// classification of a competitor the founder had ALREADY accepted, which is
// a third distinct thing and is said as one. Clauses are built and joined
// rather than nested, so a fourth destination is one push, not another
// ternary.
function plural(n: number, one: string, many: string): string { return n === 1 ? one : many; }

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function extractionSummarySentence(input: {
  itemsProposed: number;
  itemsEnriched: number;
  competitorsBackfilled: number;
  documentNames: string[];
}): string {
  const { itemsProposed, itemsEnriched, competitorsBackfilled, documentNames } = input;
  const parts: string[] = [];
  if (itemsProposed > 0) parts.push(`${itemsProposed} new ${plural(itemsProposed, 'proposal', 'proposals')} below`);
  if (itemsEnriched > 0) {
    parts.push(`${itemsEnriched} existing ${plural(itemsEnriched, 'suggestion', 'suggestions')} now ${plural(itemsEnriched, 'carries', 'carry')} Sherlock's classification`);
  }
  if (competitorsBackfilled > 0) {
    parts.push(`${competitorsBackfilled} accepted ${plural(competitorsBackfilled, 'competitor', 'competitors')} now ${plural(competitorsBackfilled, 'carries', 'carry')} Sherlock's classification`);
  }
  if (parts.length === 0) return 'Already read — nothing new in these documents.';

  const read = documentNames.length === 1
    ? `Read "${documentNames[0]}"`
    : `Read ${documentNames.length} documents`;
  // "no new proposals, but ..." only when there genuinely were none: the
  // whole point is that "nothing new" must mean nothing new.
  const body = itemsProposed === 0 ? `no new proposals, but ${joinClauses(parts)}` : joinClauses(parts);
  return `${read} — ${body}.`;
}
