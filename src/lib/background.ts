// Prompt 909 (Adenda 2) — work that must go on AFTER the response was sent.
//
// On Vercel a function is frozen the moment its response is returned, so a dangling promise never runs (confirmed in this codebase: see the note in
// api/support/submit/route.ts). `waitUntil` is the platform's own answer: it keeps the invocation alive until the promise settles (still bounded by the
// route's `maxDuration`). Outside Vercel (local dev, tests) there is no request context and `waitUntil` does nothing, so the promise simply runs
// detached on the long-lived Node process, which is what is wanted there.
//
// The promise must never reject: the caller owns its own error handling (a rejection here would be an unhandled one, with nobody to tell).
import { waitUntil } from '@vercel/functions';

export function runInBackground(work: Promise<unknown>): void {
  const safe = work.catch((e) => { console.error('[background] unhandled failure:', (e as Error)?.message ?? e); });
  waitUntil(safe);
}
