// Prompt 373 §C — "the bridge that justifies the app": investors who
// financed this org's competitors, cross-referenced against the founder's
// own pipeline. catalog_deliveries(org_id, catalog_id) is the ONE reliable
// join key in this codebase for "does this org already have this catalog
// investor in their pipeline" (confirmed by reading EntityPeoplePanel.tsx,
// network/followon/route.ts and competitor-investments/route.ts — all
// three resolve it exactly this way). A submitInvestor-created (manual)
// entity for the same investor, typed by hand, would have no
// catalog_deliveries row and so would still show as "missing" here — a
// known, accepted gap (documented in the research behind this prompt),
// not a bug: this bridge can only ever be as good as the catalog link.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { orgCompetitorsAvailable } from '@/lib/market-data-capability';
import { crossReferenceInvestors, type CompetitorInvestmentFact } from '@/lib/market-investor-bridge';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false, inPipeline: [], missing: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await orgCompetitorsAvailable())) return NextResponse.json({ available: false, inPipeline: [], missing: [] });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ available: false, inPipeline: [], missing: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: competitorRows } = await admin.from('org_competitors').select('market_company_id').eq('org_id', orgId);
  const companyIds = ((competitorRows ?? []) as { market_company_id: string }[]).map((r) => r.market_company_id);
  if (companyIds.length === 0) return NextResponse.json({ available: true, inPipeline: [], missing: [] });

  // Prompt 373 §6 (research) — do NOT `.in('investor_entity_id', ids)` on a
  // long list (confirmed to break with "fetch failed" in production per
  // competitor-investments/route.ts's own documented gotcha); this table is
  // small/admin-curated, so filter in memory instead, same as that route.
  const [{ data: investments }, { data: deliveries }] = await Promise.all([
    admin.from('investor_investments')
      .select('investor_entity_id, amount_eur, invested_at, round_type, company_id, catalog_entities(name), market_companies(name)'),
    admin.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', orgId),
  ]);

  const companyIdSet = new Set(companyIds);
  const facts: CompetitorInvestmentFact[] = ((investments ?? []) as Record<string, unknown>[])
    .filter((r) => companyIdSet.has(r.company_id as string))
    .map((r) => ({
      investorEntityId: r.investor_entity_id as string,
      investorName: (r.catalog_entities as { name?: string } | null)?.name ?? 'Unknown investor',
      companyName: (r.market_companies as { name?: string } | null)?.name ?? 'a competitor',
      amountEur: r.amount_eur as number | null, investedAt: r.invested_at as string | null, roundType: r.round_type as string | null,
    }));

  const pipelineByCatalogId = new Map(
    ((deliveries ?? []) as { catalog_id: string; entity_id: string | null }[]).map((d) => [d.catalog_id, d.entity_id]),
  );

  const result = crossReferenceInvestors(facts, pipelineByCatalogId);
  return NextResponse.json({ available: true, ...result });
}
