// Convert a mis-catalogued "fund" entity into a person (solo angel) — a
// catalog-correction, not a founder pipeline opinion (prompt 33): a wrong
// call here would misclassify the entity for every org that ever sees it
// via the shared catalog delivery path, not just this founder's own view.
// Platform-admin only — was previously a plain client-side store mutation
// (sb.from(...) writes with the founder's own session, no server gate at
// all beyond ordinary org-member RLS), which any founder could already
// call directly against Supabase's REST endpoint regardless of whether the
// UI button existed. This route is the actual fix; removing the button is
// necessary but not sufficient on its own.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: entity, error: entityErr } = await admin.from('entities')
    .select('id, org_id, name').eq('id', params.id).maybeSingle();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  if (!entity) return NextResponse.json({ ok: false, error: 'Entity not found.' }, { status: 404 });

  const lastVerified = new Date().toISOString().slice(0, 10);
  const { error: updateErr } = await admin.from('entities')
    .update({ type: 'angel_fund', last_verified: lastVerified }).eq('id', entity.id);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  const { data: person, error: personErr } = await admin.from('people').insert({
    org_id: entity.org_id, entity_id: entity.id, full_name: entity.name, seniority_rank: 1,
    linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
    hook_status: 'to_research', kill_words: [], preferred_language: 'en',
    privacy_notice_sent: false, do_not_contact: false,
  }).select('id').single();
  if (personErr) return NextResponse.json({ ok: false, error: personErr.message }, { status: 500 });

  const { error: affiliationErr } = await admin.from('person_affiliations').insert({
    org_id: entity.org_id, person_id: person.id, entity_id: null, kind: 'angel', current: true,
    is_primary: true, notes: 'Converted from a mis-imported VC-type entity — solo angel investor, no fund.',
  });
  if (affiliationErr) return NextResponse.json({ ok: false, error: affiliationErr.message }, { status: 500 });

  const { data: migratedInteractions } = await admin.from('interactions')
    .select('id').eq('entity_id', entity.id).is('person_id', null);
  const migratedIds = (migratedInteractions ?? []).map((i) => i.id);
  if (migratedIds.length) {
    await admin.from('interactions').update({ person_id: person.id }).in('id', migratedIds);
  }

  await logAdminAction(admin, {
    adminUserId: userId, action: 'entity_converted_to_person', subjectType: 'entity',
    subjectId: entity.id, detail: { entityName: entity.name, newPersonId: person.id },
  });

  return NextResponse.json({ ok: true, personId: person.id });
}
