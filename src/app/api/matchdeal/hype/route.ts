// Prompt 143 — Hype List v1. Reads the EXISTING matchdeal_startup_hype view
// (0053, weighted score/threshold, security_invoker fixed 2026-08-06 by
// 0135 — that fix stays load-bearing here: this route is the first time
// this view is ever exposed toward an authenticated client at all, so a
// regression there would leak cross-investor aggregate data straight
// through this endpoint) — no new schema, no v2 tables.
//
// Investor-role gate: eligiblePipelineOrgIds alone does NOT require an
// investor identity (it happily returns the full published list for any
// caller, is_test filtering aside) — resolveInvestorCatalogEntityId must
// resolve to a real investor membership first, or this returns empty,
// same pattern /api/portal/interest-level already uses for the same
// reason.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { eligiblePipelineOrgIds, resolveInvestorCatalogEntityId, resolveViewerIsTest } from '@/lib/portal-access';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ startups: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ startups: [] });

  const viewerIsTest = await resolveViewerIsTest(admin, investorCatalogEntityId);
  const orgIds = await eligiblePipelineOrgIds(admin, viewerIsTest);
  if (orgIds.length === 0) return NextResponse.json({ startups: [] });

  const { data: profiles } = await admin.from('matchdeal_profiles')
    .select('id, membership_id, entity_name, sectors, investment_stage_sought, country, photo_url, entity_logo_url')
    .eq('kind', 'startup').in('membership_id', orgIds);
  if (!profiles || profiles.length === 0) return NextResponse.json({ startups: [] });

  const { data: hypeRows } = await admin.from('matchdeal_startup_hype')
    .select('startup_profile_id').in('startup_profile_id', profiles.map((p) => p.id)).eq('is_hype', true);
  const hypeIds = new Set((hypeRows ?? []).map((r) => r.startup_profile_id as string));

  // Never the raw score — only the boolean already filtered it in, per the
  // doc's own "sem expor o score numerico bruto ao investidor" rule.
  const startups = profiles.filter((p) => hypeIds.has(p.id as string)).map((p) => ({
    orgId: p.membership_id, name: p.entity_name, sectors: p.sectors ?? [],
    stage: p.investment_stage_sought, country: p.country, photoUrl: p.photo_url ?? p.entity_logo_url,
  }));
  return NextResponse.json({ startups });
}
