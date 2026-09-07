// Prompt 123 Block A — enters Developer Viewer for one org. Sets the
// httpOnly cookie the rest of the app reads (developer-viewer.ts,
// store-supabase.tsx's bootstrap, /api/me), and writes the audit trail
// entry — "espreitar dados de clientes tem de deixar rasto" is the
// spec's own words for why this write can never be optional or best-effort.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { VIEWER_ORG_COOKIE, VIEWER_COOKIE_MAX_AGE, readViewerSession } from '@/lib/developer-viewer';
import { normalizeViewerReason } from '@/lib/viewer-reason';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { orgId, reason: rawReason } = await req.json().catch(() => ({})) as { orgId?: string; reason?: string };
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  // Prompt 611 §B — the reason is checked HERE, not only in the dialog. The
  // dialog can be bypassed with one fetch; commitment 4 ("logged with the
  // reason and the duration, and it is visible to you") cannot be kept by a
  // client-side check. Rejecting before anything is written also means there
  // is no such thing as a half-entered session with no reason attached.
  const reasonCheck = normalizeViewerReason(rawReason);
  if (!reasonCheck.ok) return NextResponse.json({ ok: false, error: reasonCheck.error }, { status: 400 });

  const { data: org } = await admin.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'Org not found.' }, { status: 404 });

  // Prompt 598 §B — entering while a session is already open used to leave
  // the previous one hanging: production showed two viewer_enter rows 41
  // seconds apart with no viewer_exit between them, so the log stopped being
  // able to say how long an admin spent inside an org — half the point of
  // keeping it. Close the open one first, with its real duration, exactly as
  // the exit route would have.
  const existing = readViewerSession(req);
  if (existing) {
    await admin.from('admin_audit_log').insert({
      admin_user_id: userId, action: 'viewer_exit', subject_type: 'org', subject_id: existing.orgId,
      detail: { durationMs: Date.now() - new Date(existing.enteredAt).getTime(), closedBy: 'viewer_enter' },
    });
  }

  const enteredAt = new Date().toISOString();
  await admin.from('admin_audit_log').insert({
    admin_user_id: userId, action: 'viewer_enter', subject_type: 'org', subject_id: orgId,
    detail: { orgName: org.name, enteredAt, reason: reasonCheck.reason },
  });

  const response = NextResponse.json({ ok: true, orgName: org.name });
  response.cookies.set(VIEWER_ORG_COOKIE, `${orgId}:${enteredAt}`, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: VIEWER_COOKIE_MAX_AGE,
  });
  return response;
}
