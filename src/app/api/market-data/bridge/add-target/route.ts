// Prompt 373 §C.2/§C.3 — "one click, with a hook" turns a MISSING investor
// from the bridge into a real pipeline entity, WITHOUT bypassing outreach
// discipline. Per rules.ts (confirmed by reading it in full): preflight is
// a send-time gate on a Person+channel, never an entity-creation gate —
// there is no rule anywhere that blocks creating an entity. So this route
// creates the entity (same 'source: catalog' shape unlockPack already
// uses) and stores the pre-written hook on Entity.our_angle, but NEVER logs
// an interaction or sends anything — the actual first outreach still goes
// through /log's ordinary compose flow, which still runs preflight/lint
// exactly as it would for any other entity. A catalog_deliveries row is
// also created so a LATER bridge check correctly resolves this investor as
// already-in-pipeline for this org (the same join every other reader of
// catalog_deliveries relies on).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgCompetitorsAvailable } from '@/lib/market-data-capability';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { crossReferenceInvestors, type CompetitorInvestmentFact } from '@/lib/market-investor-bridge';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
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

  const body = await req.json().catch(() => ({})) as { investorEntityId?: string };
  if (!body.investorEntityId) return NextResponse.json({ ok: false, error: 'investorEntityId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Already delivered to this org? Then this isn't "missing" any more —
  // never a second entity for the same catalog investor.
  const { data: existingDelivery } = await admin.from('catalog_deliveries')
    .select('entity_id').eq('org_id', orgId).eq('catalog_id', body.investorEntityId).maybeSingle();
  if (existingDelivery?.entity_id) return NextResponse.json({ ok: false, error: 'Already in your pipeline.' }, { status: 409 });

  const { data: catalogEntity } = await admin.from('catalog_entities').select('*').eq('id', body.investorEntityId).maybeSingle();
  if (!catalogEntity) return NextResponse.json({ ok: false, error: 'Investor not found.' }, { status: 404 });
  const c = catalogEntity as Record<string, unknown>;

  if (c.email_domain && await isEmailBlocked(admin, `contact@${c.email_domain as string}`)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  // Recomputed server-side, never trusted from the client — same discipline
  // as every other founder-facing "here's a fact about you" surface in this
  // codebase: the hook must be grounded in real rows this route itself
  // reads, not text the browser sent.
  const { data: competitorRows } = await admin.from('org_competitors').select('market_company_id').eq('org_id', orgId);
  const companyIds = ((competitorRows ?? []) as { market_company_id: string }[]).map((r) => r.market_company_id);
  const { data: investments } = companyIds.length
    ? await admin.from('investor_investments')
      .select('investor_entity_id, amount_eur, invested_at, round_type, company_id, market_companies(name)')
      .eq('investor_entity_id', body.investorEntityId)
    : { data: [] as unknown[] };
  const facts: CompetitorInvestmentFact[] = ((investments ?? []) as Record<string, unknown>[])
    .filter((r) => companyIds.includes(r.company_id as string))
    .map((r) => ({
      investorEntityId: r.investor_entity_id as string, investorName: c.name as string,
      companyName: (r.market_companies as { name?: string } | null)?.name ?? 'a competitor',
      amountEur: r.amount_eur as number | null, investedAt: r.invested_at as string | null, roundType: r.round_type as string | null,
    }));
  if (facts.length === 0) return NextResponse.json({ ok: false, error: 'No known investment ties this investor to your competitors.' }, { status: 400 });
  const { missing } = crossReferenceInvestors(facts, new Map());
  const hookLine = missing[0]?.hookLine ?? `${facts[0].companyName}`;

  const now = new Date().toISOString();
  const { data: entity, error: entityError } = await admin.from('entities').insert({
    org_id: orgId, name: c.name, type: c.type, hq_city: c.hq_city ?? null, hq_country: c.hq_country ?? null,
    invests_in_geographies: [], website: c.website ?? null, website_verified: true, email_domain_verified: false,
    stage_min: c.stage_min ?? null, stage_max: c.stage_max ?? null,
    check_min_eur: c.check_min_eur ?? null, check_max_eur: c.check_max_eur ?? null,
    sectors: c.sectors ?? [], thesis: c.thesis ?? null,
    // §C.2 — "they {hookLine}." pre-written on the entity's own angle field,
    // ready for the founder's first message — they still write and send it
    // themselves via the normal compose flow.
    our_angle: `They ${hookLine}.`,
    fit_score: 'medium', wave: 2, submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
    status: 'not_contacted', source: 'catalog', created_at: now, updated_at: now,
  }).select('id').single();
  if (entityError) return NextResponse.json({ ok: false, error: entityError.message }, { status: 500 });

  await admin.from('catalog_deliveries').insert({ org_id: orgId, catalog_id: body.investorEntityId, entity_id: entity!.id as string });

  return NextResponse.json({ ok: true, entityId: entity!.id, hookLine });
}
