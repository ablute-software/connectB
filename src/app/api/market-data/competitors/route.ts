// Prompt 373 §B/§0.2 — competitors as real cards, backed by the SHARED
// market_companies library (migration 0201). Writes go straight into that
// shared library (§0.2's decision — no quarantine, no cross-org consensus
// gate) but only from THIS validated, service-role route — RLS write stays
// is_platform_admin()-only, unchanged (§0.2 safeguard #1). Every write is
// "search before create" (§0.2 safeguard #3, market-companies-dedup.ts):
// match by domain then name against the whole shared library, update the
// existing row instead of duplicating the same company.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgCompetitorsAvailable, marketCompanyFlagsAvailable, marketResearchItemsAvailable } from '@/lib/market-data-capability';
import { addOrUpdateCompetitor } from '@/lib/market-competitor-write';
import { mergeComparableRounds, type MergedRound } from '@/lib/market-rounds-merge';
import type { RoundStructured } from '@/lib/market-research-structured';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false, competitors: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await orgCompetitorsAvailable())) return NextResponse.json({ available: false, competitors: [] });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ available: false, competitors: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Prompt 447 §D.3 — the researched-rounds query runs in parallel with
  // the existing org_competitors one; it doesn't depend on it.
  const [{ data: rows }, researchAvail] = await Promise.all([
    admin.from('org_competitors')
      .select('id, relation, note, positioning, added_by, market_company_id, market_companies(*)')
      .eq('org_id', orgId),
    marketResearchItemsAvailable(),
  ]);

  const companyIds = ((rows ?? []) as { market_company_id: string }[]).map((r) => r.market_company_id);
  const { data: investments } = companyIds.length
    ? await admin.from('investor_investments')
      .select('company_id, amount_eur, invested_at, round_type, catalog_entities(name)')
      .in('company_id', companyIds)
    : { data: [] as unknown[] };
  const investmentsByCompany = new Map<string, { amount_eur: number | null; invested_at: string | null; round_type: string | null; catalog_entities?: { name?: string } | null }[]>();
  for (const inv of (investments ?? []) as { company_id: string; amount_eur: number | null; invested_at: string | null; round_type: string | null; catalog_entities?: { name?: string } | null }[]) {
    const list = investmentsByCompany.get(inv.company_id) ?? [];
    list.push(inv);
    investmentsByCompany.set(inv.company_id, list);
  }

  const competitors = (rows ?? []).map((r: Record<string, unknown>) => ({
    id: r.id, relation: r.relation, note: r.note, positioning: r.positioning, addedBy: r.added_by,
    company: r.market_companies, rounds: investmentsByCompany.get(r.market_company_id as string) ?? [],
  }));

  // Prompt 447 §D.3 — merge each tracked competitor's own known rounds
  // with accepted `rounds` research items, deduped, tracked preferred.
  // Built from `rows` directly (not the already-mapped `competitors`) so
  // market_company_id is still on hand to key investmentsByCompany.
  const trackedRounds: MergedRound[] = ((rows ?? []) as { market_company_id: string; market_companies: { name?: string } | null }[])
    .flatMap((r) => (investmentsByCompany.get(r.market_company_id) ?? []).map((inv) => ({
      companyName: r.market_companies?.name ?? '', investorName: inv.catalog_entities?.name ?? null,
      amountEur: inv.amount_eur, investedAt: inv.invested_at, roundType: inv.round_type, source: 'competitor_tracked' as const,
    })));

  const { data: researchRoundRows } = researchAvail
    ? await admin.from('market_research_items').select('structured')
      .eq('org_id', orgId).eq('section', 'rounds').eq('status', 'accepted')
    : { data: [] as { structured: RoundStructured | null }[] };
  // Never invent an investor name — research finds the round, not who led
  // it; null here is honest, same treatment as a tracked round with no
  // known investor.
  const researchedRounds: MergedRound[] = ((researchRoundRows ?? []) as { structured: RoundStructured | null }[])
    .filter((r): r is { structured: RoundStructured } => !!r.structured)
    .map((r) => ({
      companyName: r.structured.company, investorName: null, amountEur: r.structured.amountEur,
      investedAt: r.structured.date, roundType: r.structured.stage, source: 'research' as const,
    }));

  return NextResponse.json({ available: true, competitors, rounds: mergeComparableRounds(trackedRounds, researchedRounds) });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await orgCompetitorsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as {
    action?: 'add' | 'edit' | 'remove' | 'flag'; id?: string;
    name?: string; domain?: string; sectors?: string[]; description?: string; companyType?: string;
    sourceUrl?: string; sourceQuality?: string;
    relation?: 'direct' | 'indirect' | 'adjacent'; note?: string; positioning?: string;
    justification?: string;
  };

  if (body.action === 'add') {
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ ok: false, error: 'A company name is required.' }, { status: 400 });
    // §0.2 safeguard #2 — "nothing enters without provenance."
    if (!body.sourceUrl?.trim()) return NextResponse.json({ ok: false, error: 'A source URL is required.' }, { status: 400 });
    try {
      const companyId = await addOrUpdateCompetitor(admin, orgId, {
        name, domain: body.domain?.trim() || null, sectors: body.sectors, description: body.description,
        companyType: body.companyType, sourceUrl: body.sourceUrl, sourceQuality: body.sourceQuality ?? 'secondary',
        note: body.note, positioning: body.positioning, addedBy: 'founder',
      });
      return NextResponse.json({ ok: true, companyId });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  if (body.action === 'edit') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.relation !== undefined) patch.relation = body.relation;
    if (body.note !== undefined) patch.note = body.note;
    if (body.positioning !== undefined) patch.positioning = body.positioning;
    const { error } = await admin.from('org_competitors').update(patch).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'remove') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    // Only the org's OWN relation row — the shared market_companies card
    // itself is never touched by a founder action.
    await admin.from('org_competitors').delete().eq('id', body.id).eq('org_id', orgId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'flag') {
    if (!(await marketCompanyFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    if (!body.justification?.trim()) return NextResponse.json({ ok: false, error: 'A justification is required.' }, { status: 400 });
    const { data: competitor } = await admin.from('org_competitors').select('market_company_id').eq('id', body.id).eq('org_id', orgId).maybeSingle();
    if (!competitor) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const { error } = await admin.from('market_company_flags').insert({
      market_company_id: competitor.market_company_id, org_id: orgId, justification: body.justification.trim(), flagged_by: user.id,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
