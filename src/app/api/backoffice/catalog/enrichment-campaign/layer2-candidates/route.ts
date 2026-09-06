// Prompt 581 §A.3/§B — the "hook research candidates" bucket, properly
// paginated. This used to live inside .../status's single unbounded
// query (no .limit(), no .range()) — the actual cause of the old panel
// showing "(1000)" while the true count was 3,136: Supabase's
// project-level PostgREST row cap was silently truncating the response.
// Real total: 3,136 confirmed live against production before writing
// this (see Prompt 581's own report for the exact number and query).
//
// hook_status has 3 values (to_research/researched/none_found) — the
// panel wants real counts for all three (§B.1), so `status` is a filter
// param (default to_research) rather than three separate endpoints.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const PAGE_SIZES = [25, 50, 100] as const;
const HOOK_STATUSES = ['to_research', 'researched', 'none_found'] as const;
type HookStatus = typeof HOOK_STATUSES[number];

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const params = new URL(req.url).searchParams;
  const status = (HOOK_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as HookStatus) : 'to_research';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize')) as typeof PAGE_SIZES[number] : 25;

  // Real counts for all 3 states in one go (§B.1's "3,137 to research ·
  // 10 researched · 3 none found") — same is_test/enriched-entity gate
  // the actual list below uses, so the badges and the list never disagree.
  const { data: allRaw } = await admin.from('catalog_people')
    .select('id, full_name, hook_status, entity_id, linkedin_url, catalog_entities!inner(id, name, website, sectors, thesis, enrichment_status, is_test)')
    .in('hook_status', HOOK_STATUSES);

  type Row = {
    id: string; full_name: string; hook_status: HookStatus; entity_id: string; linkedin_url: string | null;
    catalog_entities: { id: string; name: string; website: string | null; enrichment_status: string; is_test: boolean };
  };
  const eligible = ((allRaw ?? []) as unknown as Row[])
    .filter((p) => !p.catalog_entities.is_test && p.catalog_entities.enrichment_status === 'enriched');

  const counts = { toResearch: 0, researched: 0, noneFound: 0 };
  for (const p of eligible) {
    if (p.hook_status === 'to_research') counts.toResearch++;
    else if (p.hook_status === 'researched') counts.researched++;
    else counts.noneFound++;
  }

  const inStatus = eligible.filter((p) => p.hook_status === status);
  const entityIds = [...new Set(inStatus.map((p) => p.entity_id))];
  const { data: deliveries } = entityIds.length
    ? await admin.from('catalog_deliveries').select('catalog_id, org_id').in('catalog_id', entityIds)
    : { data: [] as { catalog_id: string; org_id: string }[] };
  const demandByEntity = new Map<string, number>();
  const seen = new Map<string, Set<string>>();
  for (const d of deliveries ?? []) {
    const set = seen.get(d.catalog_id) ?? new Set<string>();
    set.add(d.org_id);
    seen.set(d.catalog_id, set);
  }
  for (const [entityId, orgs] of seen) demandByEntity.set(entityId, orgs.size);

  // §B.3 — the pre-check: no LinkedIn on the person AND no website on the
  // firm means the model has nothing to search from, and 2 of the 3 real
  // none_found jobs (Isabel Eberhardt, Sven Eppert — see Prompt 581's own
  // §A report) cost €0.25-0.33 each for exactly that reason.
  const rows = inStatus
    .map((p) => ({
      id: p.id, name: p.full_name, entityName: p.catalog_entities.name,
      demand: demandByEntity.get(p.entity_id) ?? 0,
      lowChance: !p.linkedin_url && !p.catalog_entities.website,
    }))
    // §B.4 — demand first (more orgs with the firm in their pipeline is
    // where a hook actually pays off), name as the stable tiebreak.
    .sort((a, b) => b.demand - a.demand || a.name.localeCompare(b.name));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  // §B.3b — real average cost, not a guess: the last 30 days of actual
  // Layer-2 spend (enrichment_jobs.cost_eur, layer=2, done or failed —
  // a failed job still spent tokens/web calls). Falls back to null (the
  // panel shows "cost unknown yet" rather than a fabricated number) if
  // there's no history at all.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentJobs } = await admin.from('enrichment_jobs')
    .select('cost_eur').eq('layer', 2).not('cost_eur', 'is', null).gte('created_at', since);
  const costs = (recentJobs ?? []).map((j) => j.cost_eur as number).filter((c) => c > 0);
  const avgCostEur = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null;

  // §B.3b decision 1 — Nuno's own recommendation: only people whose firm
  // is in at least one org's pipeline (demand > 0), not the full
  // to_research backlog. This reuses the SAME demand signal above rather
  // than scanning catalog_outreach_supply per org for an exact
  // readiness>=55 cutoff (a platform-wide precise version of that would
  // mean one RPC call per real org just to report a planning number no
  // batch in this prompt acts on) — an honest, cheaper proxy for "worth
  // it today", not a claim of the exact recommended threshold.
  const recommendedBatchCount = status === 'to_research' ? rows.filter((r) => r.demand > 0).length : 0;

  return NextResponse.json({
    ok: true, counts, total, page, pageSize, rows: pageRows,
    avgCostEur, recommendedBatchCount,
  });
}
