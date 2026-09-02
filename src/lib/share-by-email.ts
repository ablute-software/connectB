// Prompt 545 — the founder knew exactly who he wanted to share with, and the
// product told him the feature was for people who did not.
//
// Nuno typed nunomarujo@gmail.com into "1. Which investor entity?" and got
// "From your catalog — not yet in your pipeline → Unlock on Pipeline"; the
// People & Access search said "No matching entities found." His conclusion,
// "não há forma de enviar mail", was reasonable: the thing that does exactly
// what he wanted was on the same screen, as a small grey link reading "Don't
// know who yet? Invite by email →". He DID know who. The copy disqualified him.
//
// Kept pure and separate from the page so the two rules that decide whether the
// founder ever sees the offer — is this an email, and does it beat the catalog
// suggestions — are testable without rendering anything.

// The prompt's own expression, used verbatim rather than "improved": this
// decides whether to OFFER a path, never whether an address is deliverable.
// Being liberal here is the safe direction — a false positive shows one extra
// suggestion the founder can ignore, a false negative hides the feature again,
// which is the entire bug.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string | null | undefined): boolean {
  return EMAIL_RE.test((value ?? '').trim());
}

export interface ShareByEmailOfferInput {
  /** Exactly what the founder typed. */
  query: string;
  /** Entities already in the pipeline that match the query. */
  pipelineMatchCount: number;
}

/**
 * Whether to show "Share with <email> by email →" as the FIRST suggestion.
 *
 * Only when the query is an address AND nothing in the founder's own pipeline
 * matches it: an entity they already have always wins, because sharing with a
 * known investor should go through that investor's record, not around it.
 * Catalog matches do NOT suppress the offer — they are the thing that misled
 * him, and they rank below it.
 */
export function shouldOfferShareByEmail(input: ShareByEmailOfferInput): boolean {
  return looksLikeEmail(input.query) && input.pipelineMatchCount === 0;
}

/** The address to pre-fill the ad-hoc panel with, trimmed and lowercased. */
export function normaliseShareEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type SearchSuggestionKind = 'share_by_email' | 'pipeline_entity' | 'catalog_match' | 'empty';

/**
 * The order the suggestion list renders in. Returned as kinds rather than
 * nodes so the ordering rule is assertable in a unit test — "catalog matches
 * come after, never instead" is the whole point of this prompt and is exactly
 * the kind of thing that silently regresses when someone reorders JSX.
 */
export function searchSuggestionOrder(input: {
  query: string;
  pipelineMatchCount: number;
  catalogMatchCount: number;
}): SearchSuggestionKind[] {
  const out: SearchSuggestionKind[] = [];
  if (shouldOfferShareByEmail(input)) out.push('share_by_email');
  if (input.pipelineMatchCount > 0) out.push('pipeline_entity');
  if (input.catalogMatchCount > 0) out.push('catalog_match');
  if (out.length === 0) out.push('empty');
  return out;
}
