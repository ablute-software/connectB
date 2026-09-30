// Prompt I-01 §C.1 — close an incubator: reason required; every live
// relationship ends with ended_by='platform' in the same request, and
// pending invites are revoked, so no link keeps working after the close.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { reason } = await req.json().catch(() => ({})) as { reason?: string };
  const why = reason?.trim();
  if (!why) return NextResponse.json({ ok: false, error: 'Give a reason.' }, { status: 400 });

  const now = new Date().toISOString();
  const { data: inc, error } = await admin.from('incubators')
    .update({ closed_at: now, closed_by: userId, closed_reason: why })
    .eq('id', params.id).is('closed_at', null).select('id, name').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!inc) return NextResponse.json({ ok: false, error: 'Not found or already closed.' }, { status: 404 });

  const { data: ended } = await admin.from('incubator_relationships')
    .update({ status: 'ended', ended_at: now, ended_by: 'platform', end_reason: why })
    .eq('incubator_id', inc.id).neq('status', 'ended').select('id');
  await admin.from('incubator_invites').update({ status: 'revoked', revoked_at: now })
    .eq('incubator_id', inc.id).eq('status', 'invited');

  await logAdminAction(admin, {
    adminUserId: userId, action: 'incubator_closed', subjectType: 'incubator', subjectId: inc.id,
    detail: { reason: why, relationships_ended: (ended ?? []).length },
  });
  return NextResponse.json({ ok: true, relationshipsEnded: (ended ?? []).length });
}
