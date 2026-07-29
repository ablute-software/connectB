import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { error } = await admin.from('investor_access_requests').update({
    status: 'rejected', reviewed_by: userId, reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'investor_access_request_rejected', subjectType: 'investor_access_request', subjectId: id });
  return NextResponse.json({ ok: true });
}
