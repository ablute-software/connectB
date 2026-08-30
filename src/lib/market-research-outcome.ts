// Prompt 470 §A — SectionResearchButtons.tsx's own response-handling logic,
// pulled out here (not inline in the 'use client' component) so it's
// directly testable, same reason market-portrait.ts's classifyPortraitResponse
// exists: this codebase has no DOM-testing infrastructure (no jsdom, no
// @testing-library, no JSX transform configured for vitest — importing
// anything from a .tsx file fails vitest's own parser).
//
// This is a SEPARATE function from classifyPortraitResponse, not a shared
// generic — the two components' outcome shapes genuinely differ (every
// SectionOutcome variant carries `section`; PortraitResult does not, and
// the two "found"/"success" payloads don't overlap), so forcing one generic
// type over both would be an abstraction neither call site actually needs.
// What IS shared, and must not drift: the underlying rule that body===null
// means "unreadable response", never "failed" — see classifyPortraitResponse
// for the identical principle, applied to a different payload shape.
import type { Section } from './market-research-sections';

export type SectionOutcome =
  | { kind: 'error'; section: Section; message: string }
  | { kind: 'empty'; section: Section; costEur: number | null }
  | { kind: 'found'; section: Section; costEur: number | null; count: number };

// Prompt 470 §A (Nuno's correction) — a REAL bug in the 468 §C review: it
// was verified against the wrong criterion ("was there a separate inner
// call whose own success could be lost") instead of the one Prompt 468 §C
// actually asked ("does this pass persist work before it can time out").
// It does. In src/app/api/market-data/research/route.ts, in the order the
// handler executes: `await logAiCall(...)` (the model call already ran and
// was PAID) runs, then a loop of `await admin.from('market_research_items')
// .upsert(...)` (items get WRITTEN) runs, and only after all of that does
// the route build its response. All of this happens inside that route's
// own maxDuration=60. If the gateway kills the request between the upsert
// loop and the response reaching the browser, the founder sees "took too
// long or failed" over work that is already paid for and already saved —
// exactly Prompt 468's own defect, on the button next to it.
//
// Not hypothetical: that same file's own Prompt 384 §F comment records a
// real measured window — "Vercel's 504 at maxDuration=60, confirmed via
// real runtime logs: a 42.8s success and an actual 60-80s/504 failure on
// the exact same open, multi-entity search." 42.8s of real work, 60-80s of
// an unreadable response, on the SAME search — the gap where writes commit
// and the response doesn't arrive is not theoretical.
export const TIMEOUT_MESSAGE = 'This took too long to finish. Some results may already be saved — reloading to show what came through.';

// `body` is exactly what `res.json().catch(() => null)` produces.
export function classifySectionResponse(
  section: Section,
  body: ({ ok?: boolean; aiError?: string; error?: string; items?: unknown[]; costEur?: number } & Record<string, unknown>) | null,
): SectionOutcome {
  if (!body) return { kind: 'error', section, message: TIMEOUT_MESSAGE };
  if (body.ok === false || body.aiError) {
    const message = (typeof body.aiError === 'string' && body.aiError)
      || (typeof body.error === 'string' && body.error)
      || 'Could not run this search — try again.';
    return { kind: 'error', section, message };
  }
  const count = Array.isArray(body.items) ? body.items.length : 0;
  const costEur = typeof body.costEur === 'number' ? body.costEur : null;
  if (count === 0) return { kind: 'empty', section, costEur };
  return { kind: 'found', section, costEur, count };
}
