// Prompt 904 — the backstop under src/lib/acting-org.ts's wrappers.
//
// withActingOrg()/withoutViewer() make every founder route refuse a write in a Developer Viewer session, and
// src/lib/acting-org-guard.test.ts fails the build when a route is not covered. This gate is the second,
// independent net: src/middleware.ts asks it about EVERY /api request that carries a viewer cookie, so a write
// route that was never wrapped (one added next month, one this inventory missed) is still refused — read-only
// is the default for the whole API, and what may write inside a viewer session is the short list below, in
// one place, with a reason each.
//
// Pure (no Next, no Supabase): the middleware does the one thing that needs a session — checking that the
// request really comes from a developer — and only then acts on the verdict.
//
//   pass    not a write, or a surface that is not the founder's workspace
//   forbid  a write in a viewer session: 403 viewer_read_only
//   ignore  a beacon (page view, heartbeat, product event): 200 { ignored: 'viewer' } — a developer looking at a
//           customer's workspace counts as neither the customer's activity nor their own
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Beacons: acknowledged and dropped inside a viewer session. */
export const VIEWER_IGNORED_PATHS = ['/api/events/page-view', '/api/usage/heartbeat', '/api/product-events'] as const;

/**
 * Surfaces that are NOT the founder's workspace, so a viewer cookie says nothing about them. Prefix match on a
 * path segment boundary. Every entry is a decision, not a convenience:
 */
export const VIEWER_WRITE_ALLOWLIST: readonly { prefix: string; why: string }[] = [
  { prefix: '/api/backoffice', why: 'the platform admin\'s own tools (each route re-checks requirePlatformAdmin); this is also how a viewer session is entered and left' },
  { prefix: '/api/portal', why: 'the investor workspace — a different role, deliberately untouched by the founder viewer' },
  { prefix: '/api/incubator', why: 'the ecosystem organisation workspace — a different role' },
  { prefix: '/api/calls', why: 'Calls belong to an investor firm or an ecosystem organisation, never to the founder org being viewed' },
  { prefix: '/api/stripe/webhook', why: 'signed provider webhook; carries no session' },
  { prefix: '/api/resend/webhook', why: 'signed provider webhook; carries no session' },
  { prefix: '/api/auth-code', why: 'sign-in by code: its callers have no session yet' },
  { prefix: '/api/gdpr', why: 'public privacy-request form' },
  { prefix: '/api/investor-access-request', why: 'public lead form, written to no organisation' },
  { prefix: '/api/plan/private-detective', why: 'public lead form, written to no organisation' },
  { prefix: '/api/matchdeal/pairing/consume', why: 'a device redeeming a one-time token; the token is the authorisation' },
  { prefix: '/api/terms/accept', why: 'the caller\'s own legal acceptance, written to no organisation — and a blocking modal must not trap a developer inside a viewer session' },
];

export type ViewerWriteVerdict = 'pass' | 'forbid' | 'ignore';

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function viewerWriteVerdict(method: string, pathname: string): ViewerWriteVerdict {
  if (READ_METHODS.has(method.toUpperCase())) return 'pass';
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return 'pass';
  if (VIEWER_IGNORED_PATHS.some((p) => underPrefix(pathname, p))) return 'ignore';
  if (VIEWER_WRITE_ALLOWLIST.some((a) => underPrefix(pathname, a.prefix))) return 'pass';
  return 'forbid';
}
