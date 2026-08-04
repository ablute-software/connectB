// Prompt 33 part 2 / 47 — the "Is this you?" confirmation. The invitee is
// never an org_member, so this can't go through client-side RLS writes the
// way a founder's own actions do — service-role only, same pattern as
// /api/portal/access and /api/data-room/nda-upload.
//
// The one hard security requirement (explicitly re-confirmed 2026-07-29,
// tested live for the magic-link session-scoping question): this route
// only ever operates on a grant whose invited_email matches the CALLER'S
// OWN verified session email — never trusts a grantId alone. A guessed or
// enumerated grantId from a different invite is inert without also
// controlling that exact inbox.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { grantStatus } from '@/lib/access-grants';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const sessionEmail = user?.email?.trim().toLowerCase();
  if (!sessionEmail) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({}));
  const { grantId, name, role } = body as { grantId?: string; name?: string; role?: string };
  if (!grantId || !name?.trim()) return NextResponse.json({ ok: false, error: 'Missing grantId or name.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: grant, error: grantErr } = await admin.from('access_grants').select('*').eq('id', grantId).maybeSingle();
  if (grantErr) return NextResponse.json({ ok: false, error: grantErr.message }, { status: 500 });
  if (!grant) return NextResponse.json({ ok: false, error: 'Grant not found.' }, { status: 404 });

  // The whole security property in one line: no email match, no confirm —
  // regardless of what grantId was passed.
  if (!grant.invited_email || grant.invited_email.toLowerCase() !== sessionEmail) {
    return NextResponse.json({ ok: false, error: 'This invite is not addressed to your signed-in email.' }, { status: 403 });
  }
  if (grant.revoked_at) return NextResponse.json({ ok: false, error: 'This invite has been revoked.' }, { status: 410 });
  if (grantStatus(grant, new Date()) !== 'pending_confirmation') {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  const trimmedName = name.trim();
  const trimmedRole = role?.trim() || null;
  const editedFields: { field: string; before: unknown; after: unknown }[] = [];

  let personEntityId: string | null = null;
  if (grant.person_id) {
    const { data: person } = await admin.from('people').select('id, entity_id, full_name').eq('id', grant.person_id).maybeSingle();
    if (person) {
      personEntityId = person.entity_id;
      if (trimmedName && trimmedName !== person.full_name) {
        editedFields.push({ field: 'full_name', before: person.full_name, after: trimmedName });
        await admin.from('people').update({ full_name: trimmedName }).eq('id', person.id);
      }
      if (trimmedRole) {
        const { data: affiliation } = await admin.from('person_affiliations')
          .select('id, title').eq('person_id', person.id).eq('entity_id', person.entity_id).maybeSingle();
        if (affiliation && trimmedRole !== affiliation.title) {
          editedFields.push({ field: 'title', before: affiliation.title, after: trimmedRole });
          await admin.from('person_affiliations').update({ title: trimmedRole }).eq('id', affiliation.id);
        }
      }
    }
  }

  const confirmed_at = new Date().toISOString();
  // The founder's "grant access" flow (Prompt 47) writes one access_grants
  // row per selected folder/document node, so a single invite to one person
  // is really N rows sharing the same invited_email + org_id. The invitee
  // only sees ONE "Is this you?" card (deduped client-side) and confirms
  // once — that confirmation must land on every one of those rows, not just
  // the grantId the card happened to reference, or the other N-1 stay
  // pending_confirmation forever and their documents never unlock.
  const { error: updateErr } = await admin.from('access_grants')
    .update({ confirmed_at, self_verified: true })
    .eq('org_id', grant.org_id).eq('invited_email', grant.invited_email).is('confirmed_at', null).is('revoked_at', null);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  // §1c contributions queue — decision 2026-07-29: ALWAYS one whole-record
  // confirmation row (this is the strongest signal the app has, even with
  // zero edits), PLUS one row per field the invitee actually changed. Same
  // queue every other contribution already uses — no second mechanism.
  if (grant.person_id) {
    const rows = [
      {
        subject_type: 'person', subject_id: grant.person_id, org_id: grant.org_id, author_user_id: user!.id,
        field: 'identity_confirmation',
        value: { name: trimmedName, role: trimmedRole, entity_id: personEntityId, confirmed: true },
        status: 'submitted',
      },
      ...editedFields.map((f) => ({
        subject_type: 'person' as const, subject_id: grant.person_id, org_id: grant.org_id, author_user_id: user!.id,
        field: f.field, value: { before: f.before, after: f.after }, status: 'submitted' as const,
      })),
    ];
    await admin.from('contributions').insert(rows);
  }

  return NextResponse.json({ ok: true });
}
