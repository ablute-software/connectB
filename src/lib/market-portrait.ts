// Prompt 378 §D — which documents the cold-start "build my market portrait"
// pass reads when the founder hasn't picked any. Pure and testable, and
// deliberately the SAME heuristic MarketDataPanel's own picker already
// pre-selects with (Prompt 370 §C1) — extracted here so the server can
// apply it without duplicating a second, drifting copy of the regex.
//
// A disclosed false-negative-only guess: it can miss a market document with
// an unusual name, and the founder can always pick documents by hand. What
// it must never do is sweep the whole Vault — that's real money per
// document, and most of a Vault is not market material.
// `deck` (not just `pitch`) is load-bearing: ablute_'s own deck is filed as
// "ablute_ investor deck", which the original Prompt 370 picker regex
// (pitch|market|sizing|competitive|business.?plan|strategy) silently missed
// — caught by this module's own test fixture, using the real filename.
export const PORTRAIT_DOC_HEURISTIC = /pitch|deck|market|sizing|competitive|competitor|landscape|business.?plan|strategy|tam|sam|som/i;
export const MAX_PORTRAIT_DOCS = 8;

export interface PortraitDocCandidate { id: string; name: string; folderName: string }

export function pickPortraitDocuments(docs: PortraitDocCandidate[]): string[] {
  return docs
    .filter((d) => PORTRAIT_DOC_HEURISTIC.test(d.name) || PORTRAIT_DOC_HEURISTIC.test(d.folderName))
    .slice(0, MAX_PORTRAIT_DOCS)
    .map((d) => d.id);
}
