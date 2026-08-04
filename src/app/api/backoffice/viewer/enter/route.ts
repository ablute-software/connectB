// Prompt 123 Block A — enters Developer Viewer for one org. Sets the
// httpOnly cookie the rest of the app reads (developer-viewer.ts,
// store-supabase.tsx's bootstrap, /api/me), and writes the audit trail
// entry — "espreitar dados de clientes tem de deixar rasto" is the
// spec's own words for why this write can never be optional or best-effort.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { VIEWER_ORG_COOKIE, VIEWER_COOKIE_MAX_AGE } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { orgId } = await req.json().catch(() => ({})) as { orgId?: string };
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const { data: org } = await admin.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'Org not found.' }, { status: 404 });

  const enteredAt = new Date().toISOString();
  await admin.from('admin_audit_log').insert({
    admin_user_id: userId, action: 'viewer_enter', subject_type: 'org', subject_id: orgId,
    detail: { orgName: org.name, enteredAt },
  });

  const response = NextResponse.json({ ok: true, orgName: org.name });
  response.cookies.set(VIEWER_ORG_COOKIE, `${orgId}:${enteredAt}`, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: VIEWER_COOKIE_MAX_AGE,
  });
  return response;
}
