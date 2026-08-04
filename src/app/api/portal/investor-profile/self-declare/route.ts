// Identity verification Fase A (prompt 63), Bloco 4 — Business Angel
// without a company. matchdeal_investor_members.catalog_entity_id is
// NOT NULL (schema predates this flow), so a BA still needs a catalog row
// to satisfy the FK — a small dedicated one created per person here, not a
// shared pseudo-entity (each BA should have their own, e.g. so a future
// "colleagues at your firm" list correctly shows nobody rather than
// grouping unrelated individuals together).
//
// LEGAL TEXT IS PLACEHOLDER — see the exact strings this route accepts
// below. Do not swap in different copy without an explicit instruction; the
// version string is stored precisely so a future real-copy swap can tell
// which investors acknowledged which wording.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

const ACK_VERSION = 'placeholder-v1';
const EXPECTED_ACK_TEXT = 'I confirm I am acting as an individual investor and not as a regulated entity. [Placeholder — legal copy pending review].';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // Same no-op-write guard as add-firm/route.ts — QA sessions never
  // legitimately reach this screen, but defense in depth for a direct call.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { ackText?: string };
  // The client must echo back the exact placeholder text it showed —
  // cheap defense against a future UI change silently sending a different
  // acknowledgment than what was actually displayed to the investor.
  if (body.ackText !== EXPECTED_ACK_TEXT) {
    return NextResponse.json({ ok: false, error: 'Acknowledgment text mismatch.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const existingMember = await resolveActiveInvestorMember(admin, user.id);

  let member: { id: string; catalog_entity_id: string } | null = existingMember;
  if (!member) {
    const { data: entity, error: entityError } = await admin.from('catalog_entities').insert({
      name: `${email} — Individual investor`, type: 'vc', verification_status: 'pending',
      source: 'self_declared_individual', catalog_status: 'imported',
    }).select('id').single();
    if (entityError || !entity) return NextResponse.json({ ok: false, error: entityError?.message ?? 'Could not create profile.' }, { status: 500 });

    const { data: created, error: memberError } = await admin.from('matchdeal_investor_members')
      .insert({ user_id: user.id, catalog_entity_id: entity.id, status: 'active' })
      .select('id, catalog_entity_id').single();
    if (memberError || !created) return NextResponse.json({ ok: false, error: memberError?.message ?? 'Could not link.' }, { status: 500 });
    member = created;
  }

  const { data: existingProfile } = await admin.from('matchdeal_profiles').select('id')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();

  const patch = { self_declared_individual: true, self_declared_at: new Date().toISOString(), self_declared_ack_version: ACK_VERSION };
  const { error } = existingProfile
    ? await admin.from('matchdeal_profiles').update(patch).eq('id', existingProfile.id)
    : await admin.from('matchdeal_profiles').insert({ membership_id: member.id, kind: 'investor', ...patch });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
