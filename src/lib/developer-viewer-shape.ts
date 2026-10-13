// Prompt 123 Block A — pure cookie-parsing helpers, split out from
// developer-viewer.ts (which is 'server-only' and pulls in Next.js request/
// response types) so this can be unit-tested directly without a
// server-only resolution error under vitest. No side effects, no Next.js
// imports.
// The cookie's name lives here, not in developer-viewer.ts, so src/middleware.ts (which cannot import a
// 'server-only' module) can see whether a request carries a viewer session at all.
export const VIEWER_ORG_COOKIE = 'sd_viewer_org_id';

// What a viewer session answers to anything that is not a read (Prompt 904). Here, not in developer-viewer.ts,
// for the same reason as the cookie name: src/middleware.ts answers with it too.
export const VIEWER_READ_ONLY_CODE = 'viewer_read_only';
export const VIEWER_READ_ONLY_MESSAGE = 'Read-only in Developer Viewer.';

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
