// Prompt 187 §C — [id] is the catalog_people id. PATCH edits the person's
// own fields (name/linkedin — the fields the back-office form actually
// exposes; hook_status/do_not_contact stay whatever the enrichment
// pipeline already set, not overwritten here). DELETE removes only the
// affiliation to ONE entity (?entityId=), not the person globally — the
// same person can legitimately be affiliated with more than one entity
// (moved firms, sits on multiple boards), so "remove contact" from a
// single entity's panel must never silently delete them everywhere.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as { fullName?: string; linkedinUrl?: string; title?: string; entityId?: string };
  const personPatch: Record<string, unknown> = {};
  if (body.fullName !== undefined) personPatch.full_name = body.fullName.trim();
  if (body.linkedinUrl !== undefined) personPatch.linkedin_url = body.linkedinUrl.trim() || null;

  if (Object.keys(personPatch).length > 0) {
    const { error } = await admin.from('catalog_people').update(personPatch).eq('id', params.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (body.title !== undefined && body.entityId) {
    const { error } = await admin.from('catalog_person_affiliations')
      .update({ title: body.title.trim() || null }).eq('person_id', params.id).eq('entity_id', body.entityId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_person_updated', subjectType: 'catalog_person', subjectId: params.id, detail: { ...personPatch, title: body.title } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return NextResponse.json({ ok: false, error: 'entityId is required.' }, { status: 400 });

  const { error } = await admin.from('catalog_person_affiliations').delete().eq('person_id', params.id).eq('entity_id', entityId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_person_removed', subjectType: 'catalog_entity', subjectId: entityId, detail: { personId: params.id } });
  return NextResponse.json({ ok: true });
}
