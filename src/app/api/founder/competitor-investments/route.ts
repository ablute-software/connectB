// Prompt 292 §Fase 1 (Pedido 6) — the founder-facing read of the shared
// investor_investments library (migration 0201), batched once for the
// whole org rather than per-entity: same pattern as investor-interest and
// messages routes on this Pipeline page (interestedEntityIds/
// activeThreadEntityIds), one fetch on mount, not an N+1 per row. Reused
// as-is by the entities/[id] dossier too (CompetitorInvestmentCard.tsx),
// which just filters this same response client-side for its one entity —
// a small over-fetch, but avoids a second, parallel query implementation
// for identical RLS-open, platform-level data.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { competitorInvestmentsAvailable } from '@/lib/competitor-investments-capability';

export async function GET() {
  if (!authEnabled) return NextResponse.json({ ok: true, items: [] });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, items: [] });

  if (!(await competitorInvestmentsAvailable())) return NextResponse.json({ ok: true, items: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  const orgId = (member?.org_id as string | undefined) ?? null;
  if (!orgId) return NextResponse.json({ ok: true, items: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, items: [] });
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // catalog_id -> this org's own entities.id (the org-side copy) —
  // exactly Prompt 291's link rule, reused: an investor_investments row
  // is keyed on the shared catalog_id, but the Pipeline/dossier only ever
  // know their own local entities.id.
  const { data: deliveries } = await admin.from('catalog_deliveries')
    .select('catalog_id, entity_id').eq('org_id', orgId).not('entity_id', 'is', null);
  if (!deliveries || deliveries.length === 0) return NextResponse.json({ ok: true, items: [] });
  const entityIdByCatalogId = new Map(deliveries.map((d) => [d.catalog_id as string, d.entity_id as string]));

  // Deliberately NOT `.in('investor_entity_id', catalogIds)` — confirmed
  // live against ablute_'s real data (525 distinct delivered catalog
  // ids): that many UUIDs in one filter builds a query string long enough
  // to fail the underlying fetch outright (no clean Postgres error, just
  // a raw "TypeError: fetch failed"). investor_investments is a sparse,
  // admin-curated table — orders of magnitude smaller than the catalog
  // itself — so pulling it whole and filtering in memory against the map
  // above is both correct and, for the foreseeable data volume, cheaper
  // than a filtered round-trip would be anyway.
  const { data: investments, error } = await admin.from('investor_investments')
    .select('investor_entity_id, amount_eur, invested_at, round_type, still_held, sold_at, sold_amount_eur, confidence, market_companies ( name )')
    .order('invested_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (investments ?? [])
    .filter((inv) => entityIdByCatalogId.has(inv.investor_entity_id as string))
    .map((inv) => {
      const company = Array.isArray(inv.market_companies) ? inv.market_companies[0] : inv.market_companies;
      return {
        entityId: entityIdByCatalogId.get(inv.investor_entity_id as string) ?? null,
        companyName: company?.name ?? null,
        amountEur: inv.amount_eur, investedAt: inv.invested_at, roundType: inv.round_type,
        stillHeld: inv.still_held, soldAt: inv.sold_at, soldAmountEur: inv.sold_amount_eur, confidence: inv.confidence,
      };
    }).filter((i) => i.entityId && i.companyName);

  return NextResponse.json({ ok: true, items });
}
