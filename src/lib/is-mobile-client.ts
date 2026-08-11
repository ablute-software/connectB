// Prompt 82 — client-side "is this a phone?" signal for gating the
// MatchDeal deck (/pair). Deliberately UX, not security: a user-agent is
// trivial to spoof, and that's fine here — the thing actually guarding
// account takeover is the pairing token/RPC layer (migration 0009 and
// friends), untouched by this file. This only stops the ordinary case
// (someone opens the link on their laptop out of habit or during a demo).
//
// User-agent is the primary signal (explicit per the prompt) because it's
// the one signal a real phone can't accidentally trip in the other
// direction — a desktop with a touchscreen monitor would false-negative
// on a touch-only check. matchMedia(pointer: coarse) is the fallback for
// the rare UA that doesn't match the regex (some in-app browsers rewrite
// their UA) but is still clearly a touch handheld.
const MOBILE_UA_RE = /Android|iPhone|iPad|iPod|Mobile|BlackBerry|IEMobile|Opera Mini/i;

export function isMobileUserAgent(ua: string): boolean {
  return MOBILE_UA_RE.test(ua);
}

// Returns null until the client has actually checked (avoids an SSR/first-
// paint mismatch or a flash of the wrong branch), then a stable boolean.
export function detectMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isMobileUserAgent(navigator.userAgent)) return true;
  if (typeof window !== 'undefined' && window.matchMedia) {
    // Prompt 163 A — confirmed live on Nuno's own touchscreen PC: a
    // desktop Chrome (desktop UA, so the regex above correctly said no)
    // fell through to this fallback, matched `pointer: coarse` via the
    // touchscreen, and opened the full deck on a desktop — the exact false
    // positive Prompt 82's comment anticipated but had never seen happen.
    // Two extra signals, both required to still call it a phone:
    // 1. `any-pointer: fine` must be absent — true whenever ANY fine
    //    pointer (mouse, trackpad, pen) is attached, even non-primary; no
    //    real phone has one.
    // 2. The screen's SHORTER dimension must be phone-sized. Measured on
    //    the exact machine that reproduced the bug (2026-08-11): it
    //    reports pointer:coarse, hover:none, maxTouchPoints:10 AND
    //    any-pointer:fine=false — a touchscreen PC indistinguishable from
    //    a phone by pointer media queries alone, which is why signal 1 by
    //    itself wasn't enough and Prompt 161 A's suggested viewport-width
    //    second layer is applied too. Real phones' shorter CSS dimension
    //    is ~320-450px; the smallest desktop/laptop panels are ≥600.
    //    (Touch tablets like iPad land ≥768 here, but those match the UA
    //    regex above and never reach this fallback.)
    const touchOnly = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    const hasFinePointer = window.matchMedia('(any-pointer: fine)').matches;
    // screen.* can report 0×0 in embedded/offscreen browsers (observed on
    // the same machine, in an Electron pane) — fall back to the viewport,
    // and treat a size we can't determine as NOT a phone (every real phone
    // browser reports its real screen size; only desktops embed).
    const shortSide = Math.min(window.screen.width || 0, window.screen.height || 0)
      || Math.min(window.innerWidth, window.innerHeight);
    const phoneSizedScreen = shortSide > 0 && shortSide < 600;
    return touchOnly && !hasFinePointer && phoneSizedScreen;
  }
  return false;
}
