// Investor identity verification, Fase B (prompt 64), Bloco 3 — request a
// reference. The requester names someone they know by email; there's no
// investor directory to browse, so this is deliberately a plain "type the
// email of someone you know" flow. Whether that person is actually
// Verified is checked at CONFIRM time (confirm/route.ts), not here — this
// route doesn't need to know anything about the target account yet, it
// just mints the single-use link.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { computeIdentityStatus } from '@/lib/investor-identity';
import { countDistinctVoucherEntities, generateVouchToken } from '@/lib/investor-vouching';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ linked: false });

  const { data: vouches } = await admin.from('investor_vouches')
    .select('id, target_email, status, requested_at, confirmed_at')
    .eq('requester_user_id', user.id).order('requested_at', { ascending: false });
  const distinctCount = await countDistinctVoucherEntities(admin, member.catalog_entity_id);

  return NextResponse.json({ linked: true, vouches: vouches ?? [], distinctVoucherEntityCount: distinctCount });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // @ablute.pt sessions never enter the real trust graph, per the prompt's
  // own non-negotiable — neither requesting nor (see confirm/route.ts)
  // giving a reference counts for real.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { targetEmail?: string };
  const targetEmail = body.targetEmail?.trim().toLowerCase();
  if (!targetEmail) return NextResponse.json({ ok: false, error: 'targetEmail is required.' }, { status: 400 });
  if (targetEmail === user.email?.trim().toLowerCase()) {
    return NextResponse.json({ ok: false, error: "You can't vouch for yourself." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const { data: entity } = await admin.from('catalog_entities').select('verification_status').eq('id', member.catalog_entity_id).maybeSingle();
  const distinctCount = await countDistinctVoucherEntities(admin, member.catalog_entity_id);
  const { data: profile } = await admin.from('matchdeal_profiles').select('self_declared_individual')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  const status = computeIdentityStatus({
    selfDeclaredIndividual: !!profile?.self_declared_individual, domainVerified: false,
    entityVerificationStatus: entity?.verification_status ?? null, distinctVoucherEntityCount: distinctCount,
  });
  if (status === 'verified') return NextResponse.json({ ok: false, error: "You're already verified." }, { status: 400 });

  const token = generateVouchToken();
  const { error } = await admin.from('investor_vouches').insert({
    requester_user_id: user.id, requester_catalog_entity_id: member.catalog_entity_id, target_email: targetEmail, token,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, link: `/portal/vouch/${token}` });
}
