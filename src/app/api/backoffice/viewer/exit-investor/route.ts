// Prompt 611 §F — "mesma saída, mesma duração". Mirrors the org exit route
// exactly, including its idempotence: exiting with no open session is a
// successful no-op, because the client calls this on unmount and on
// navigate-away and must not be able to produce an error by leaving twice.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { VIEWER_INVESTOR_COOKIE, readInvestorViewerSession } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const session = readInvestorViewerSession(req);
  if (session) {
    await admin.from('admin_audit_log').insert({
      admin_user_id: userId, action: 'viewer_exit', subject_type: 'investor_entity', subject_id: session.orgId,
      detail: { durationMs: Date.now() - new Date(session.enteredAt).getTime() },
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIEWER_INVESTOR_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
  return response;
}
