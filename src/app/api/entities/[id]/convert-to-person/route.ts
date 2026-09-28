// Convert a mis-catalogued "fund" entity into a person (solo angel) — a
// catalog-correction, not a founder pipeline opinion (prompt 33). `entities`
// is this founder's own org-scoped pipeline table (not the shared catalog),
// so the right authorization is the same one every sibling route in this
// directory already uses (enrich, report-fraud, form-questions): a real
// member of the entity's own org, checked via the session-scoped client
// against org_members — never platform-admin status alone.
//
// Prompt 892 — this used to be requirePlatformAdmin() with NO org-membership
// check at all and no assertNotViewer: any platform admin session (viewer
// mode active or not) could write a real people/person_affiliations row and
// mutate interactions for ANY org's entity, just by knowing its id. Was
// previously a plain client-side store mutation (sb.from(...) writes with
// the founder's own session, no server gate at all beyond ordinary org-
// member RLS), which any founder could already call directly against
// Supabase's REST endpoint regardless of whether the UI button existed.
// This route is the actual fix; removing the button is necessary but not
// sufficient on its own.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities')
    .select('id, org_id, name').eq('id', params.id).maybeSingle();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  if (!entity) return NextResponse.json({ ok: false, error: 'Entity not found.' }, { status: 404 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });
  const userId = user.id;

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
