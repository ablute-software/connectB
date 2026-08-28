// Prompt 421 §C — the investor's self-declared past investments (Import
// tab). Same investor-portal convention as every other mutation here:
// admin (service-role) client server-side, never a direct browser+RLS
// write, even though the table's own RLS policy would technically allow
// it — belt and suspenders, matching investor-profile/route.ts and every
// other route in this directory.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

const NAME_MAX_LEN = 200;
const AMOUNT_MAX_EUR = 10_000_000_000; // 10bn — a sanity cap, not a real limit

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

  const { data } = await admin.from('investor_declared_investments')
    .select('id, company_name, sector, invested_at, round_type, amount_eur')
    .eq('catalog_entity_id', member.catalog_entity_id).order('invested_at', { ascending: false, nullsFirst: false });

  return NextResponse.json({ linked: true, investments: data ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    companyName?: string; sector?: string | null; investedAt?: string | null; roundType?: string | null; amountEur?: number | null;
  };
  const companyName = (body.companyName ?? '').trim();
  if (!companyName) return NextResponse.json({ ok: false, error: 'Company name is required.' }, { status: 400 });
  if (companyName.length > NAME_MAX_LEN) return NextResponse.json({ ok: false, error: 'Company name is too long.' }, { status: 400 });
  const amountEur = body.amountEur != null ? Number(body.amountEur) : null;
  if (amountEur != null && (!Number.isFinite(amountEur) || amountEur < 0 || amountEur > AMOUNT_MAX_EUR)) {
    return NextResponse.json({ ok: false, error: 'Amount is not valid.' }, { status: 400 });
  }

  const { data: inserted, error } = await admin.from('investor_declared_investments').insert({
    catalog_entity_id: member.catalog_entity_id, created_by: user.id,
    company_name: companyName, sector: body.sector?.trim() || null,
    invested_at: body.investedAt || null, round_type: body.roundType?.trim() || null, amount_eur: amountEur,
  }).select('id, company_name, sector, invested_at, round_type, amount_eur').single();
  if (error || !inserted) return NextResponse.json({ ok: false, error: error?.message ?? 'Could not save.' }, { status: 500 });

  return NextResponse.json({ ok: true, investment: inserted });
}

export async function DELETE(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400 });

  // Scoped to the caller's own firm, not just any id — the same "own firm,
  // never cross-firm" boundary the RLS policy itself enforces, checked
  // again here since this route uses the admin client (bypasses RLS).
  const { error } = await admin.from('investor_declared_investments').delete()
    .eq('id', id).eq('catalog_entity_id', member.catalog_entity_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
