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

// Prompt 468 §A/§B — MarketPortraitCard.tsx's own response-handling logic,
// pulled out here (not left inline in the 'use client' component) so it's
// directly testable: this codebase has no DOM-rendering test
// infrastructure (no jsdom, no @testing-library, no JSX transform
// configured for vitest — importing anything at all from a .tsx file fails
// vitest's own parser), and a component whose file this module already
// exists to keep testable logic OUT of is exactly where this belongs.
export interface PortraitResult {
  documentsRead: number; costEur: number; cached: boolean;
  ringsProposed: number; ringsNote: string | null; competitorsProposed: number;
}

// Three genuinely different situations, never one bare string: this
// route's own error (unchanged behavior), an unreadable response (this
// prompt's own case, see classifyPortraitResponse below), and a real
// network failure (unchanged). Modeled as a type, not a string, so the
// timeout case can never accidentally render through the same "failed +
// Retry" path the other two still correctly use.
export type BuildError =
  | { kind: 'own'; message: string }
  | { kind: 'timeout' }
  | { kind: 'network' };

export type BuildOutcome =
  | { kind: 'success'; result: PortraitResult }
  | { kind: 'error'; buildError: BuildError; callOnDoneFirst: boolean };

// Named constants, not inline JSX strings, so the "never says failed"
// property is directly testable without rendering anything.
export const TIMEOUT_MESSAGE = 'This took too long to finish. Some results may already be saved — refreshing to show what came through.';
export const NETWORK_MESSAGE = 'Could not reach the server — check your connection and try again.';

// `body` is exactly what `res.json().catch(() => null)` produces — null is
// the unreadable-response case (504/HTML gateway page) this prompt is
// about.
//
// body === null is NOT proof this failed. /api/market-data/portrait's own
// maxDuration=60 wraps an INNER call to /api/market-data/document-extract
// — which has its OWN maxDuration=60 and, critically, already fully
// returned its own successful HTTP response (paid for, written) by the
// time this OUTER wrapper goes on to do MORE work (rings/competitors) and
// build ITS OWN response. What can die past 60s is only the final hop back
// to the browser, after the real work is already done. Observed directly
// in production, 2026-08-29 18:55:48-50: a €0.293 model call logged, 12
// new market_research_items rows written, then exactly the old "failed"
// screen with a Retry button that would have paid for the same reading
// again. So: callOnDoneFirst=true for this case — reload BEFORE the
// message even renders, so the founder sees what's actually there before
// reading anything at all; the message itself must never say "failed" and
// must never offer Retry as the primary action, because repeating pays for
// work that is very possibly already saved. Never infer server state from
// the HTTP outcome alone — always go look.
export function classifyPortraitResponse(body: ({ ok?: boolean; error?: string } & Record<string, unknown>) | null): BuildOutcome {
  if (!body) return { kind: 'error', buildError: { kind: 'timeout' }, callOnDoneFirst: true };
  if (!body.ok) {
    return {
      kind: 'error',
      buildError: { kind: 'own', message: typeof body.error === 'string' ? body.error : 'Could not build your market portrait — try again.' },
      callOnDoneFirst: false,
    };
  }
  return { kind: 'success', result: body as unknown as PortraitResult };
}
