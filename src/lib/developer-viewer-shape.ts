// Prompt 123 Block A — pure cookie-parsing helpers, split out from
// developer-viewer.ts (which is 'server-only' and pulls in Next.js request/
// response types) so this can be unit-tested directly without a
// server-only resolution error under vitest. No side effects, no Next.js
// imports.
export interface ViewerSession { orgId: string; enteredAt: string }

// Cookie value is "<orgId>:<enteredAtIso>" — enteredAt travels in the
// cookie itself (not a second DB round-trip) purely so the exit route can
// log a session duration; it is never used for anything security-relevant.
export function parseViewerCookieValue(raw: string): ViewerSession | null {
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const orgId = raw.slice(0, idx);
  const enteredAt = raw.slice(idx + 1);
  return orgId && enteredAt ? { orgId, enteredAt } : null;
}

export function extractCookieFromHeader(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
