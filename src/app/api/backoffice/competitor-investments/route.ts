// Prompt 292 §Fase 1 (Pedidos 1+2) — manual/admin path to feed
// investor_investments (migration 0201), reusing the same auth/route
// SHAPE as /api/backoffice/research/route.ts (platform-admin-only,
// serverClient() session check, service-role admin client) — not that
// route's AI web-search call itself, which is Pedido 4's job (Fase 2,
// silent background research against enrichment_jobs). Fase 1 is
// explicitly "mínimo viável": an admin who already knows a fact (from
// their own reading) records it here, with a real source and an honest
// confidence — never invents a number to fill a field.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { competitorInvestmentsAvailable } from '@/lib/competitor-investments-capability';
import { logAdminAction } from '@/lib/audit';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await competitorInvestmentsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: rows, error } = await admin.from('investor_investments')
    .select(`
      id, amount_eur, invested_at, round_type, stake_pct_at_investment, still_held, sold_at, sold_amount_eur,
      stake_pct_current, source, confidence, created_at,
      catalog_entities ( id, name ),
      catalog_people ( id, full_name ),
      market_companies ( id, name, domain, sectors )
    `)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    items: (rows ?? []).map((r) => {
      const investor = Array.isArray(r.catalog_entities) ? r.catalog_entities[0] : r.catalog_entities;
      const person = Array.isArray(r.catalog_people) ? r.catalog_people[0] : r.catalog_people;
      const company = Array.isArray(r.market_companies) ? r.market_companies[0] : r.market_companies;
      return {
        id: r.id, investorName: investor?.name ?? '(deleted)', investorPersonName: person?.full_name ?? null,
        companyName: company?.name ?? '(deleted)', companyDomain: company?.domain ?? null, companySectors: company?.sectors ?? [],
        amountEur: r.amount_eur, investedAt: r.invested_at, roundType: r.round_type,
        stakePctAtInvestment: r.stake_pct_at_investment, stillHeld: r.still_held,
        soldAt: r.sold_at, soldAmountEur: r.sold_amount_eur, stakePctCurrent: r.stake_pct_current,
        source: r.source, confidence: r.confidence, createdAt: r.created_at,
      };
    }),
  });
}

interface CompanyFields {
  domain?: string; sectors?: string[]; description?: string;
  lastKnownValuationEur?: number; lastRoundType?: string; lastRoundDate?: string; lastRoundAmountEur?: number;
  sourceUrl?: string; sourceDate?: string; sourceQuality?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await competitorInvestmentsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as {
    investorName?: string; companyName?: string; companyFields?: CompanyFields;
    amountEur?: number; investedAt?: string; roundType?: string; stakePctAtInvestment?: number;
    stillHeld?: boolean; soldAt?: string; soldAmountEur?: number; stakePctCurrent?: number;
    source?: string; confidence?: 'high' | 'medium' | 'low';
  };
  const investorName = body.investorName?.trim();
  const companyName = body.companyName?.trim();
  if (!investorName || !companyName) {
    return NextResponse.json({ ok: false, error: 'investorName and companyName are both required.' }, { status: 400 });
  }

  // Resolve the investor against the shared catalog — never free text on
  // this side, so an investment can't silently point at a typo'd name
  // with no real catalog_entities row behind it.
  const { data: investorMatches, error: investorErr } = await admin
    .from('catalog_entities').select('id, name').ilike('name', investorName);
  if (investorErr) return NextResponse.json({ ok: false, error: investorErr.message }, { status: 500 });
  if (!investorMatches || investorMatches.length === 0) {
    return NextResponse.json({ ok: false, error: `No catalog investor matches "${investorName}".` }, { status: 404 });
  }
  if (investorMatches.length > 1) {
    return NextResponse.json({ ok: false, error: `Ambiguous — ${investorMatches.length} catalog investors match "${investorName}". Be more specific.` }, { status: 409 });
  }
  const investorEntityId = investorMatches[0].id as string;

  // Resolve or create the company — "uma empresa só entra aqui uma vez":
  // reuse an existing row by exact (case-insensitive) name before ever
  // creating a new one, same lookup-before-create discipline Pedido 4's
  // worker will use later.
  const { data: companyMatches, error: companyErr } = await admin
    .from('market_companies').select('id, name').ilike('name', companyName);
  if (companyErr) return NextResponse.json({ ok: false, error: companyErr.message }, { status: 500 });
  if (companyMatches && companyMatches.length > 1) {
    return NextResponse.json({ ok: false, error: `Ambiguous — ${companyMatches.length} companies already match "${companyName}". Be more specific.` }, { status: 409 });
  }

  let companyId: string;
  if (companyMatches && companyMatches.length === 1) {
    companyId = companyMatches[0].id as string;
  } else {
    const cf = body.companyFields ?? {};
    const { data: created, error: createErr } = await admin.from('market_companies').insert({
      name: companyName, domain: cf.domain || null, sectors: cf.sectors ?? [], description: cf.description || null,
      last_known_valuation_eur: cf.lastKnownValuationEur ?? null, last_round_type: cf.lastRoundType || null,
      last_round_date: cf.lastRoundDate || null, last_round_amount_eur: cf.lastRoundAmountEur ?? null,
      source_url: cf.sourceUrl || null, source_date: cf.sourceDate || null, source_quality: cf.sourceQuality || null,
    }).select('id').single();
    if (createErr) return NextResponse.json({ ok: false, error: createErr.message }, { status: 500 });
    companyId = created.id as string;
  }

  const { data: investment, error: insertErr } = await admin.from('investor_investments').insert({
    investor_entity_id: investorEntityId, company_id: companyId,
    amount_eur: body.amountEur ?? null, invested_at: body.investedAt || null, round_type: body.roundType || null,
    stake_pct_at_investment: body.stakePctAtInvestment ?? null, still_held: body.stillHeld ?? null,
    sold_at: body.soldAt || null, sold_amount_eur: body.soldAmountEur ?? null, stake_pct_current: body.stakePctCurrent ?? null,
    source: body.source || null, confidence: body.confidence || null, created_by: userId,
  }).select('id').single();
  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'competitor_investment_recorded', subjectType: 'investor_investments',
    subjectId: investment.id, detail: { investorName, companyName, investorEntityId, companyId },
  });

  return NextResponse.json({ ok: true, id: investment.id });
}
