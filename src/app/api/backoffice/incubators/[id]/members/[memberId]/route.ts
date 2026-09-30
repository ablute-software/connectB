// Prompt I-01 §C.1 — remove a member (status 'removed'; nothing is deleted).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function DELETE(_req: Request, { params }: { params: { id: string; memberId: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data, error } = await admin.from('incubator_members')
    .update({ status: 'removed', removed_at: new Date().toISOString(), invite_token_hash: null })
    .eq('id', params.memberId).eq('incubator_id', params.id).neq('status', 'removed')
    .select('id').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  await admin.from('incubator_relationships').update({ manager_member_id: null }).eq('manager_member_id', data.id);
  await logAdminAction(admin, { adminUserId: userId, action: 'incubator_member_removed', subjectType: 'incubator', subjectId: params.id, detail: { member_id: data.id } });
  return NextResponse.json({ ok: true });
}
