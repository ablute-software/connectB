// Prompt 581 §A.3/§B, hardened by Prompt 871 §B — the "hook research
// candidates" bucket, properly paginated. This used to live inside
// .../status's single unbounded query (no .limit(), no .range()) — the
// actual cause of the old panel showing "(1000)" while the true count was
// 3,136: Supabase's project-level PostgREST row cap was silently
// truncating the response.
//
// The §B fix itself repeated the exact same bug one level down: its own
// `allRaw` query (no .limit()/.range()) hit the same cap, just now behind
// a plausible 1000-ish number instead of an obviously-wrong "(1000)" —
// found by a separate verification session, confirmed live (3,142 real
// eligible rows the day it was found). Counts and the current page are now
// both computed server-side (migration 0329's two RPCs) — an aggregate
// count and a LIMIT/OFFSET query are never subject to the response-row
// cap the way an unbounded .select() is.
//
// hook_status has 3 values (to_research/researched/none_found) — the
// panel wants real counts for all three (§B.1), so `status` is a filter
// param (default to_research) rather than three separate endpoints.
//
// Prompt 583 §C — migration 0332 narrowed both RPCs to only ever return
// people worth a €0.30+ hook-research call: rank <= 2 by default (Nuno's
// own recommendation, "until hook quality is proven"), cascading to 3 or
// 4 only when a firm's whole roster has nobody more senior, rank 9 never.
// seniority_rank now comes through in the page response for that reason —
// it's the exact number the cascade decided on, not decoration.
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

  type CountsRow = { to_research: number; researched: number; none_found: number; to_research_with_demand: number };
  type PageRow = { id: string; full_name: string; entity_name: string; demand: number; low_chance: boolean; seniority_rank: number | null };

  const [{ data: countsRaw, error: countsErr }, { data: pageRaw, error: pageErr }, { data: recentJobs }] = await Promise.all([
    admin.rpc('catalog_layer2_candidate_counts'),
    admin.rpc('catalog_layer2_candidates_page', { p_status: status, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
    // §B.3b — real average cost, not a guess: the last 30 days of actual
    // Layer-2 spend (enrichment_jobs.cost_eur, layer=2, done or failed —
    // a failed job still spent tokens/web calls). Falls back to null (the
    // panel shows "cost unknown yet" rather than a fabricated number) if
    // there's no history at all.
    admin.from('enrichment_jobs').select('cost_eur').eq('layer', 2).not('cost_eur', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (countsErr) return NextResponse.json({ ok: false, error: countsErr.message }, { status: 500 });
  if (pageErr) return NextResponse.json({ ok: false, error: pageErr.message }, { status: 500 });

  const countsRow = (countsRaw as CountsRow[] | null)?.[0];
  const counts = {
    toResearch: Number(countsRow?.to_research ?? 0),
    researched: Number(countsRow?.researched ?? 0),
    noneFound: Number(countsRow?.none_found ?? 0),
  };
  const total = status === 'to_research' ? counts.toResearch : status === 'researched' ? counts.researched : counts.noneFound;

  const rows = ((pageRaw as PageRow[] | null) ?? []).map((r) => ({
    id: r.id, name: r.full_name, entityName: r.entity_name,
    demand: Number(r.demand), lowChance: r.low_chance, seniorityRank: r.seniority_rank,
  }));

  const costs = (recentJobs ?? []).map((j) => j.cost_eur as number).filter((c) => c > 0);
  const avgCostEur = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null;

  // §B.3b decision 1 — Nuno's own recommendation: only people whose firm
  // is in at least one org's pipeline (demand > 0), not the full
  // to_research backlog. Computed server-side now (migration 0329) so it
  // reflects the real backlog, not an in-memory slice of a capped array.
  const recommendedBatchCount = status === 'to_research' ? Number(countsRow?.to_research_with_demand ?? 0) : 0;

  return NextResponse.json({
    ok: true, counts, total, page, pageSize, rows,
    avgCostEur, recommendedBatchCount,
  });
}
