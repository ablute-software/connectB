// Investor identity verification, Fase B (prompt 64), Bloco 3 — confirm a
// reference request. Never an anonymous/open form: the confirming session
// must be the signed-in target of the token (email match), and their OWN
// identity_status must independently compute to 'verified' — never trust
// the request-time state, always re-check live.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { computeIdentityStatus } from '@/lib/investor-identity';
import { countDistinctVoucherEntities } from '@/lib/investor-vouching';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: vouch } = await admin.from('investor_vouches')
    .select('id, status, target_email, expires_at, requester_catalog_entity_id, catalog_entities:requester_catalog_entity_id(name)')
    .eq('token', token).maybeSingle();
  if (!vouch) return NextResponse.json({ error: 'Link not found.' }, { status: 404 });

  return NextResponse.json({
    status: vouch.status, targetEmail: vouch.target_email,
    requesterEntityName: (vouch.catalog_entities as unknown as { name: string } | null)?.name ?? 'Unknown',
    expired: new Date(vouch.expires_at as string) < new Date(),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: false, error: 'Test accounts cannot vouch.' }, { status: 403 });

  const { token } = await req.json().catch(() => ({})) as { token?: string };
  if (!token) return NextResponse.json({ ok: false, error: 'token is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: vouch } = await admin.from('investor_vouches').select('*').eq('token', token).maybeSingle();
  if (!vouch) return NextResponse.json({ ok: false, error: 'Link not found.' }, { status: 404 });
  if (vouch.status !== 'pending') return NextResponse.json({ ok: false, error: 'This reference has already been used.' }, { status: 409 });
  if (new Date(vouch.expires_at as string) < new Date()) return NextResponse.json({ ok: false, error: 'This link has expired.' }, { status: 410 });
  if (vouch.target_email !== email) return NextResponse.json({ ok: false, error: "This reference request wasn't sent to you." }, { status: 403 });
  if (vouch.requester_user_id === user.id) return NextResponse.json({ ok: false, error: "You can't vouch for yourself." }, { status: 400 });

  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });
  if (member.catalog_entity_id === vouch.requester_catalog_entity_id) {
    return NextResponse.json({ ok: false, error: "You're at the same firm as the requester — this doesn't count as an independent reference." }, { status: 400 });
  }

  const { data: entity } = await admin.from('catalog_entities').select('verification_status').eq('id', member.catalog_entity_id).maybeSingle();
  const { data: profile } = await admin.from('matchdeal_profiles').select('self_declared_individual')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  const distinctCount = await countDistinctVoucherEntities(admin, member.catalog_entity_id);
  const myStatus = computeIdentityStatus({
    selfDeclaredIndividual: !!profile?.self_declared_individual, domainVerified: false,
    entityVerificationStatus: entity?.verification_status ?? null, distinctVoucherEntityCount: distinctCount,
  });
  if (myStatus !== 'verified') return NextResponse.json({ ok: false, error: 'Only verified investors can confirm a reference.' }, { status: 403 });

  const { error } = await admin.from('investor_vouches').update({
    status: 'confirmed', voucher_user_id: user.id, voucher_catalog_entity_id: member.catalog_entity_id, confirmed_at: new Date().toISOString(),
  }).eq('id', vouch.id).eq('status', 'pending');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
