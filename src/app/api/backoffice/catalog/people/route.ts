// Prompt 187 §C — manual contact management for a catalog_entities row.
// GET lists an entity's contacts (same join GET /api/backoffice/catalog
// already does — kept here too so a single entity's contact panel doesn't
// have to re-fetch the whole catalog just to refresh itself). POST creates
// a new catalog_people row AND the catalog_person_affiliations row that
// actually attaches it to the entity — catalog_people.entity_id is
// "convenience only, NOT source of truth" (its own migration's words), so
// writing that column alone would silently not show up anywhere real reads.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return NextResponse.json({ ok: false, error: 'entityId is required.' }, { status: 400 });

  const { data: affiliations, error } = await admin.from('catalog_person_affiliations')
    .select('id, entity_id, title, is_primary, catalog_people(id, full_name, linkedin_url, hook_status, do_not_contact)')
    .eq('entity_id', entityId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const contacts = (affiliations ?? []).map((a) => {
    const person = a.catalog_people as unknown as { id: string; full_name: string; linkedin_url: string | null; hook_status: string; do_not_contact: boolean } | null;
    return person && {
      affiliationId: a.id, personId: person.id, fullName: person.full_name, linkedinUrl: person.linkedin_url,
      hookStatus: person.hook_status, doNotContact: person.do_not_contact, title: a.title, isPrimary: !!a.is_primary,
    };
  }).filter(Boolean);

  return NextResponse.json({ ok: true, contacts });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as { entityId?: string; fullName?: string; linkedinUrl?: string; title?: string };
  if (!body.entityId || !body.fullName?.trim()) {
    return NextResponse.json({ ok: false, error: 'entityId and fullName are required.' }, { status: 400 });
  }

  const { data: person, error: personErr } = await admin.from('catalog_people').insert({
    full_name: body.fullName.trim(), linkedin_url: body.linkedinUrl?.trim() || null, entity_id: body.entityId,
  }).select().single();
  if (personErr) return NextResponse.json({ ok: false, error: personErr.message }, { status: 500 });

  const { error: affErr } = await admin.from('catalog_person_affiliations').insert({
    person_id: person.id, entity_id: body.entityId, title: body.title?.trim() || null,
  });
  if (affErr) {
    // Roll back the orphaned person row rather than leave a contact that
    // shows up nowhere (no affiliation = invisible to every real reader).
    await admin.from('catalog_people').delete().eq('id', person.id);
    return NextResponse.json({ ok: false, error: affErr.message }, { status: 500 });
  }

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_person_added', subjectType: 'catalog_entity', subjectId: body.entityId,
    detail: { personId: person.id, fullName: person.full_name },
  });

  return NextResponse.json({ ok: true, personId: person.id });
}
