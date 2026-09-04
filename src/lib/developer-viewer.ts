// Prompt 123 Block A — Developer Viewer. A platform developer opens a
// startup's full workspace read-only, for support/QA, with three
// independent write-blocking layers: RLS (is_org_member already denies a
// non-member), this file's assertNotViewer() (every service-role mutating
// route must call it first), and a disabled UI (cosmetic — the two above
// are the real boundary, per the prompt's own "UI escondida não é
// segurança").
//
// The cookie is a bare httpOnly value, same trust model as
// matchdeal-pairing.ts's DEVICE_ID_COOKIE: it is NEVER treated as an
// authorization credential by itself. Every consumer (assertNotViewer
// here, /api/me, the enter/exit routes) independently re-checks
// is_ablute_developer() via a real session before trusting it — the
// cookie only ever says "which org", never "you're allowed to write".
//
// Pure cookie-value parsing lives in developer-viewer-shape.ts instead of
// here, so it's unit-testable without pulling in 'server-only' + Next.js
// request/response types.
import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseViewerCookieValue, extractCookieFromHeader, type ViewerSession } from './developer-viewer-shape';

export const VIEWER_ORG_COOKIE = 'sd_viewer_org_id';
export const VIEWER_COOKIE_MAX_AGE = 4 * 60 * 60; // 4 hours — a forgotten session still ends itself

export type { ViewerSession };

function rawViewerCookie(req: NextRequest | Request): string | null {
  // NextRequest has .cookies; a plain Request (used by a few older routes)
  // does not — parse the header directly in that case.
  const anyReq = req as NextRequest;
  if (anyReq.cookies?.get) return anyReq.cookies.get(VIEWER_ORG_COOKIE)?.value ?? null;
  return extractCookieFromHeader(req.headers.get('cookie') ?? '', VIEWER_ORG_COOKIE);
}

export function readViewerSession(req: NextRequest | Request): ViewerSession | null {
  const raw = rawViewerCookie(req);
  return raw ? parseViewerCookieValue(raw) : null;
}

// Deliberately NOT exported — see readVerifiedViewerOrgId below. The cookie
// is unsigned: "<orgId>:<iso>" written by anyone with a terminal. A raw read
// of it is only ever safe inside a caller that has ALREADY established the
// session is a developer (/api/me gates on role === 'developer'; the exit
// route on requirePlatformAdmin()). Prompt 559 §A: four routes read it
// without that gate, so the gate now travels with the read.
function readViewerOrgId(req: NextRequest | Request): string | null {
  return readViewerSession(req)?.orgId ?? null;
}

// Prompt 559 §A — the only way a route may turn the viewer cookie into an
// org id. Returns the viewed org ONLY when this request's real session also
// currently resolves as a developer; null otherwise, which every caller must
// treat as "no viewer session" and fall back to its own membership check.
//
// The bug this closes had two shapes, and the second is the reason this is a
// function rather than a comment. In matchdeal-firm the cookie SKIPPED the
// membership check (`if (viewerOrgId !== entity.org_id)`); in pipeline-unlock,
// page-view and heartbeat it took PRIORITY over the membership lookup
// (`let orgId = readViewerOrgId(req); if (!orgId) { ...members... }`), so a
// forged cookie silently redirected a service-role read (and, in
// pipeline-unlock, a write) at any org whose id the caller could name — and
// /portal/startup/[orgId] hands investors real org ids in the URL.
export async function readVerifiedViewerOrgId(
  sb: SupabaseClient,
  req: NextRequest | Request,
): Promise<string | null> {
  const orgId = readViewerOrgId(req);
  if (!orgId) return null;
  const { data: isDeveloper } = await sb.rpc('is_ablute_developer');
  return isDeveloper ? orgId : null;
}

// Called at the top of every service-role mutating route (.insert/.update/
// .delete/.upsert/a state-changing .rpc). Returns a 403 NextResponse to
// return immediately if the caller is in an active viewer session; null if
// the request may proceed. Re-checks is_ablute_developer() itself via `sb`
// (the request-scoped session client) rather than trusting the cookie's
// mere presence — a stale cookie on a session that's no longer a developer
// (e.g. platform_admins row removed) must not still block or unblock
// anything on that basis alone; the check that actually matters is "does a
// viewer cookie exist on a request that also currently resolves as a
// developer", both independently true.
export async function assertNotViewer(sb: SupabaseClient, req: NextRequest | Request): Promise<NextResponse | null> {
  const viewerOrgId = readViewerOrgId(req);
  if (!viewerOrgId) return null;
  const { data: isDeveloper } = await sb.rpc('is_ablute_developer');
  if (!isDeveloper) return null; // stale/foreign cookie on a non-developer session — not this helper's concern
  return NextResponse.json({ ok: false, error: 'Viewer mode is read-only.' }, { status: 403 });
}
