// Prompt I-01 §C.1 — edit an incubator (all A.1 fields, incl. the D3 link).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { parseIncubatorFields } from '@/lib/incubator-admin-input';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const parsed = parseIncubatorFields(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  // The slug is not re-derived on edit: renaming must not break a link.
  const { slug: _slug, ...fields } = parsed.fields;
  void _slug;

  const { data, error } = await admin.from('incubators').update(fields).eq('id', params.id).select('*').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  await logAdminAction(admin, { adminUserId: userId, action: 'incubator_updated', subjectType: 'incubator', subjectId: data.id, detail: fields });
  return NextResponse.json({ ok: true, incubator: data });
}
