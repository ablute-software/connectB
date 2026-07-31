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
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  }
  return false;
}
