// Prompt 686 §B — a deploy replaces the JS chunk files a browser tab
// already has cached references to; the next click that needs a NEW chunk
// (a route the user hadn't visited yet this session) 404s, and with no
// handling at all that's a silent, fully blank page (confirmed live:
// "ChunkLoadError: Loading chunk 9668 failed" → React error #423 → nothing
// on screen, no message). Any user with the app open across a deploy hits
// this on their next navigation — for a pilot investor's first click, a
// blank screen is exactly the credibility cost Prompt 680 exists to avoid.
//
// Pure decision logic, kept separate from the DOM-touching listener
// component (ChunkErrorRecovery.tsx) so it can be unit-tested without
// jsdom/@testing-library (neither exists in this repo — see
// FrostedGate.test.ts's own header for why every DOM-adjacent test here is
// either pure-logic or source-inspection).
export function isChunkLoadError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /ChunkLoadError|Loading chunk [\w.-]+ failed|Loading CSS chunk|error loading dynamically imported module/i.test(message);
}

// sessionStorage, not a module-level variable: a hard reload re-runs this
// module from scratch, so an in-memory flag would never survive the very
// reload it's meant to guard. sessionStorage survives a reload but not a
// new tab, which is the right scope — a fresh tab deserves its own first
// try, not to inherit a stuck flag from a tab that already gave up.
export const CHUNK_RELOAD_GUARD_KEY = 'sd_chunk_reload_guard';

/**
 * Whether this is the FIRST chunk-load failure this tab has seen since
 * its last hard reload (in which case: reload once, guarded), or a repeat
 * (in which case: reloading again clearly isn't fixing it, so don't loop —
 * let the caller show a normal "Reload" error message instead). Setting
 * the flag is a side effect of asking the question exactly once, on
 * purpose: the caller must not call this more than once per real failure.
 */
export function shouldAutoReloadForChunkError(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  if (storage.getItem(CHUNK_RELOAD_GUARD_KEY)) return false;
  storage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
  return true;
}
