// Identity verification Fase A (prompt 63), Bloco 1 — "My firm isn't
// listed." Creates a new catalog_entities row (verification_status
// 'pending' — the existing enum/RLS axis already keeps non-verified rows
// out of founder catalog reads and packs, see 0002_catalog.sql; no new
// status needed), links the investor to it immediately so onboarding
// continues (never a dead end), and records who proposed it for backoffice
// review. If the investor's email domain happens to match the website they
// gave, domain_verified is set true right away — no reason to make them
// wait on admin review when the same evidence link/route.ts already trusts
// is present.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { checkInvestorDomainMatch, isAutoEligible } from '@/lib/investor-domain-match';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // @ablute.pt sessions never reach this screen in normal use (Bloco 2's
  // GET-time bypass links them straight to the QA pseudo-entity) — this is
  // defense in depth for a direct call, same no-op-write guard every other
  // portal write route uses.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { name?: string; website?: string };
  const name = body.name?.trim();
  const website = body.website?.trim() || null;
  if (!name) return NextResponse.json({ ok: false, error: 'Firm name is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: entity, error: entityError } = await admin.from('catalog_entities')
    .insert({ name, website, type: 'vc', verification_status: 'pending', source: 'investor_added', catalog_status: 'imported' })
    .select('id, name, website').single();
  if (entityError || !entity) return NextResponse.json({ ok: false, error: entityError?.message ?? 'Could not create entity.' }, { status: 500 });

  await admin.from('investor_added_entities').insert({ catalog_entity_id: entity.id, added_by_user_id: user.id, added_by_email: email });

  const verdict = website
    ? checkInvestorDomainMatch({ email, firmName: entity.name, entities: [{ id: entity.id, name: entity.name, website: entity.website }] })
    : null;
  const domainVerified = verdict ? isAutoEligible(verdict) : false;

  const { data: member, error: memberError } = await admin.from('matchdeal_investor_members')
    .upsert({ user_id: user.id, catalog_entity_id: entity.id, status: 'active', domain_verified: domainVerified }, { onConflict: 'user_id,catalog_entity_id' })
    .select('id').single();
  if (memberError || !member) return NextResponse.json({ ok: false, error: memberError?.message ?? 'Could not link.' }, { status: 500 });

  return NextResponse.json({ ok: true, membershipId: member.id, entityName: entity.name, domainVerified });
}
