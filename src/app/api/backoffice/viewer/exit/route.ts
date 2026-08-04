// Prompt 123 Block A — exits Developer Viewer. Logs duration (from the
// entry timestamp carried in the cookie itself, never a second table) and
// clears the cookie. Idempotent: exiting with no active session is a no-op
// success, not an error — the client always calls this on unmount/navigate-away.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { VIEWER_ORG_COOKIE, readViewerSession } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const session = readViewerSession(req);
  if (session) {
    const durationMs = Date.now() - new Date(session.enteredAt).getTime();
    await admin.from('admin_audit_log').insert({
      admin_user_id: userId, action: 'viewer_exit', subject_type: 'org', subject_id: session.orgId,
      detail: { durationMs },
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIEWER_ORG_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
  return response;
}
