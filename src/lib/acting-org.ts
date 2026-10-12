// Prompt 904 — ONE answer to "which org is this founder-side request acting on?",
// and ONE rule for what a Developer Viewer may do there.
//
// The bug this closes (12/10/2026, "Insignals" opened in Developer Viewer by an
// ablute_ admin): ~120 founder-side API routes each carried their own
// `org_members ... .eq('user_id', user.id).maybeSingle()` and so answered with the
// CALLER's own org (ablute_) while the shell around them was dressed as the viewed
// org. Documents, claims, Market data, the incubator relation, support tickets, the
// network contacts and the Action plan of ablute_ rendered inside Insignals — and
// every Save / Accept / Create invite / Post update clicked there would have written
// to ablute_. Prompt 902 fixed the Vault's 16 call sites one by one; this file makes
// the class impossible to re-open one route at a time:
//
//   • resolveActingOrg()  — viewer session (verified: cookie AND is_ablute_developer)
//                           → the VIEWED org; otherwise → the caller's membership.
//                           Nothing under src/app/api reads org_members to find
//                           "the current org" any more (src/lib/acting-org.test.ts
//                           greps for it).
//   • withActingOrg()     — wraps a route handler. In a viewer session every
//                           POST/PUT/PATCH/DELETE answers 403 `viewer_read_only`
//                           BEFORE the handler runs, unless the handler is
//                           explicitly listed (`allowViewerWrite`, today: none). The
//                           exception is visible in the code, not an omission.
//   • withoutViewer()     — the inverse, for the routes that act on the CALLER's own
//                           account (password, billing, accepting an invitation):
//                           every method answers 403 in a viewer session.
//   • viewer_read audit   — one `admin_audit_log` row per route per viewer session,
//                           next to the existing viewer_enter / viewer_exit.
//
// The cookie is unsigned (see developer-viewer.ts): it only ever says WHICH org.
// Whether the request is a viewer session at all is decided by re-checking
// is_ablute_developer() on the caller's real session, once per request.
import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from './supabase-server';
import { readVerifiedViewerOrgId, readViewerSession, viewerReadOnlyResponse } from './developer-viewer';

export { viewerReadOnlyResponse };

export type ActingMode = 'member' | 'viewer';

export interface ActingOrg {
  /** The org this request acts on. Null only when the caller has no org at all. */
  orgId: string | null;
  mode: ActingMode;
  /**
   * The caller's role in `orgId`. In a viewer session the developer is not a member
   * of the viewed org, so there is no membership row to read a role from; they see
   * what the owner sees (the point of the viewer is to reproduce the founder's
   * screen) and cannot change any of it (the wrapper refuses every write).
   */
  role: string | null;
}

/** What a developer is shown the permission matrix as, inside a viewer session. */
export const VIEWER_ROLE = 'owner';

type Caller = { id: string };
type AnyRequest = NextRequest | Request;

// One is_ablute_developer() round-trip per request, however many helpers ask.
const verifiedByRequest = new WeakMap<object, Promise<string | null>>();

function verifiedViewerOrg(sb: SupabaseClient, req: AnyRequest): Promise<string | null> {
  let pending = verifiedByRequest.get(req);
  if (!pending) {
    pending = readVerifiedViewerOrgId(sb, req);
    verifiedByRequest.set(req, pending);
  }
  return pending;
}

/** Cheap, local: is there a viewer cookie on this request at all? (Says nothing about trust.) */
function hasViewerCookie(req: AnyRequest): boolean {
  return readViewerSession(req) !== null;
}

async function sessionClient(sb?: SupabaseClient): Promise<SupabaseClient> {
  return sb ?? ((await serverClient()) as unknown as SupabaseClient);
}

/**
 * The acting org for a founder-side request. `sb` is the request-scoped (cookie
 * session) client; pass the one the route already holds, or omit it.
 */
export async function resolveActingOrg(req: AnyRequest, user: Caller, sb?: SupabaseClient): Promise<ActingOrg> {
  const client = await sessionClient(sb);
  const viewed = await verifiedViewerOrg(client, req);
  if (viewed) return { orgId: viewed, mode: 'viewer', role: VIEWER_ROLE };
  const { data: member } = await client.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  return {
    orgId: (member?.org_id as string | undefined) ?? null,
    mode: 'member',
    role: (member?.role as string | undefined) ?? null,
  };
}

/**
 * The same decision for a route whose client NAMES the org (?orgId=… / body): in a
 * viewer session only the viewed org is acceptable — naming the developer's own org,
 * or any third one, is refused — and outside one the caller must be a member of
 * exactly the org they named. Never trusts the id on its own. Null = not allowed.
 */
export async function authorizeActingOrg(
  req: AnyRequest,
  user: Caller,
  orgId: string,
  sb?: SupabaseClient,
): Promise<ActingOrg | null> {
  const client = await sessionClient(sb);
  const viewed = await verifiedViewerOrg(client, req);
  if (viewed) return viewed === orgId ? { orgId, mode: 'viewer', role: VIEWER_ROLE } : null;
  const { data: member } = await client
    .from('org_members').select('org_id, role').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  return member ? { orgId, mode: 'member', role: (member.role as string | undefined) ?? null } : null;
}

/** True when this request is a verified Developer Viewer session. */
export async function isViewerRequest(req: AnyRequest, sb?: SupabaseClient): Promise<boolean> {
  if (!hasViewerCookie(req)) return false;
  return (await verifiedViewerOrg(await sessionClient(sb), req)) !== null;
}

// ─── wrappers ───────────────────────────────────────────────────────────────

export interface ActingOrgOptions {
  /**
   * A reviewed exception: this write handler MAY run inside a viewer session. Every
   * use is listed, with its reason, in src/lib/acting-org.test.ts — today: none.
   */
  allowViewerWrite?: boolean;
  /**
   * The handler is skipped entirely in a viewer session and the caller gets
   * `200 { ok: true, ignored: 'viewer' }`. For beacons (page views, heartbeats,
   * product events): a developer looking at a customer's workspace must count as
   * neither the customer's activity nor their own.
   */
  ignoreInViewer?: boolean;
}

type Handler<R extends Request, A extends unknown[]> = (req: R, ...args: A) => Promise<Response> | Response;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRead(req: AnyRequest): boolean {
  return READ_METHODS.has(req.method.toUpperCase());
}

/**
 * Wrap a founder-side route handler: `export const POST = withActingOrg(async (req) => …)`.
 * Outside a viewer session it is a pass-through.
 */
export function withActingOrg<R extends Request, A extends unknown[]>(
  handler: Handler<R, A>,
  opts: ActingOrgOptions = {},
): (req: R, ...args: A) => Promise<Response> {
  return async (req: R, ...args: A): Promise<Response> => {
    // No cookie → cannot be a viewer: no session client is built, no RPC is made.
    if (!hasViewerCookie(req)) return handler(req, ...args);
    const sb = await sessionClient();
    const viewed = await verifiedViewerOrg(sb, req);
    // A cookie on a session that is not (or no longer) a developer: not our concern.
    if (!viewed) return handler(req, ...args);

    if (opts.ignoreInViewer) return NextResponse.json({ ok: true, ignored: 'viewer' });
    if (!isRead(req)) {
      if (!opts.allowViewerWrite) return viewerReadOnlyResponse();
    } else {
      await auditViewerRead(sb, req, viewed);
    }
    return handler(req, ...args);
  };
}

/**
 * The inverse rule, for routes that act on the CALLER's own account or billing —
 * change password, pay, accept an invitation, close the org. A developer in a viewer
 * session does none of these on anyone's behalf: every method answers 403.
 */
export function withoutViewer<R extends Request, A extends unknown[]>(
  handler: Handler<R, A>,
): (req: R, ...args: A) => Promise<Response> {
  return async (req: R, ...args: A): Promise<Response> => {
    if (!hasViewerCookie(req)) return handler(req, ...args);
    const sb = await sessionClient();
    const viewed = await verifiedViewerOrg(sb, req);
    if (!viewed) return handler(req, ...args);
    return viewerReadOnlyResponse();
  };
}

// ─── viewer_read audit ──────────────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `/api/entities/3f2a…-…/notes?x=1` → `/api/entities/:id/notes` (no ids, no query: nothing personal in the log). */
export function normalizeAuditRoute(req: AnyRequest): string {
  const { pathname } = new URL(req.url);
  return pathname.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
}

// One row per route per viewer session. The Set is the cheap first level (one
// serverless instance); the select below makes it exact across instances.
const auditSeen = new Set<string>();
const AUDIT_SEEN_MAX = 5000;

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Best-effort by design — unlike viewer_enter, which is the hard gate (reason +
 * audit or no session). A failing log write must not stop a support session
 * mid-way; the failure is logged loudly instead.
 */
async function auditViewerRead(sb: SupabaseClient, req: AnyRequest, viewedOrgId: string): Promise<void> {
  try {
    const session = readViewerSession(req);
    if (!session) return;
    const route = normalizeAuditRoute(req);
    const key = `${viewedOrgId}|${session.enteredAt}|${route}`;
    if (auditSeen.has(key)) return;
    if (auditSeen.size >= AUDIT_SEEN_MAX) auditSeen.clear();
    auditSeen.add(key);

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const admin = serviceClient();
    if (!admin) return;

    const { data: prior } = await admin
      .from('admin_audit_log').select('id')
      .eq('admin_user_id', user.id).eq('action', 'viewer_read').eq('subject_id', viewedOrgId)
      .eq('detail->>enteredAt', session.enteredAt).eq('detail->>route', route)
      .limit(1);
    if (prior && prior.length > 0) return;

    await admin.from('admin_audit_log').insert({
      admin_user_id: user.id, action: 'viewer_read', subject_type: 'org', subject_id: viewedOrgId,
      detail: { route, enteredAt: session.enteredAt },
    });
  } catch (e) {
    console.error('[acting-org] viewer_read audit failed', e);
  }
}

/** Test seam: forget which routes were already logged. */
export function _resetViewerReadAuditForTests(): void {
  auditSeen.clear();
}
