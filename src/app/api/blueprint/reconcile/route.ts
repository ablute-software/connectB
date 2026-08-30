// Prompt 358 Phase 2.1 — "reconciliation must also run on every document
// upload/rename." Upload already goes through the extraction pipeline; a
// RENAME never triggers extraction (the file's content didn't change, only
// its name — which extraction has no reason to re-run for), so it needs
// this separate, lightweight trigger instead. Fire-and-forget from the
// client (store-supabase.tsx's renameDocument) — never blocks the rename.
//
// Task D2 (docs/execution-queue.md) — this route no longer has a
// reconciliation path of its own. It used to call runReconciliationForOrg
// directly, which made it a SECOND way to do exactly what
// /api/reconciliation/run (Prompt 465 §B) already does — and two paths to
// the same work is how 465 itself came about: one of them always drifts,
// and the one that drifts is the one nobody is looking at.
// /api/reconciliation/run's own header already flagged this overlap and
// deliberately left it for its own prompt. This is that prompt.
//
// It delegates rather than being deleted: the URL stays alive for the
// existing caller (no 404 to handle in store-supabase.tsx), while the
// implementation — auth, the viewer check, the capability probe, the
// try/catch, the always-log contract — lives in exactly one place. An alias
// cannot diverge from what it forwards to.
//
// What DELEGATING changes, stated rather than discovered later:
//   - `assertNotViewer` now applies here too. Before, a developer-viewer
//     could trigger a paid reconciliation by renaming a document; now they
//     can't. That closes a gap rather than removing a capability, and the
//     founder's own path is untouched.
//   - the response body becomes /api/reconciliation/run's shape
//     ({ok, ran, autoLinked, suggested, uncovered, reason}) instead of
//     {ok, ...ReconcileOutcome} — which also carried `costEur`. Invisible
//     in practice: the ONE caller is
//     `fetch('/api/blueprint/reconcile', {method:'POST'}).catch(() => {})`
//     and never reads the body at all.
import { POST as reconciliationRun } from '@/app/api/reconciliation/run/route';

// maxDuration is per-route Next config, not something an imported handler
// carries with it — it has to be re-declared here or this route would keep
// the shorter default budget while the work it forwards to expects 60s.
export const maxDuration = 60;

export async function POST(req: Request) {
  return reconciliationRun(req);
}
