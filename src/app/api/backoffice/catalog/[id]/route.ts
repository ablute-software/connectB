import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

const EDITABLE_FIELDS = [
  'name', 'type', 'hq_city', 'hq_country', 'sectors', 'stage_min', 'stage_max',
  'check_min_eur', 'check_max_eur', 'thesis', 'website', 'notes',
] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json() as Record<string, unknown> & { verification_status?: 'verified' | 'rejected' | 'pending' };
  const patch: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) if (f in body) patch[f] = body[f];
  if (body.verification_status) {
    patch.verification_status = body.verification_status;
    if (body.verification_status === 'verified') { patch.verified_at = new Date().toISOString(); patch.verified_by = userId; }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await admin.from('catalog_entities').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_update', subjectType: 'catalog_entity', subjectId: params.id, detail: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { error } = await admin.from('catalog_entities').delete().eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: `${error.message} — it may still be referenced by a submission or pack.` }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_delete', subjectType: 'catalog_entity', subjectId: params.id });
  return NextResponse.json({ ok: true });
}
