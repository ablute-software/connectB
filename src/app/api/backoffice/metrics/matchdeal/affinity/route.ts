import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

// Prompt 297 §2 — profile affinity: does this viewer spend longer / like
// more often on profiles with certain attributes (sector, stage, entity
// type)? No new table — reuses matchdeal_exposures (viewer_profile_id,
// shown_profile_id, shown_at) and matchdeal_swipes (actor_profile_id,
// target_profile_id, direction, created_at) from migration 0053.
//
// Decision-time approximation, stated plainly: for each swipe, "decision
// time" = created_at minus the MOST RECENT prior exposure of that exact
// (viewer, target) pair. This is an approximation, not a measured dwell
// time — two ways it can be wrong, both accepted as known limitations
// rather than hidden:
//   1. Re-exposure — if the same profile was shown to the same viewer more
//      than once before the swipe, only the LATEST prior exposure counts;
//      an earlier "first look" that the viewer came back to after a gap
//      would inflate the count of exposures but never appear as its own
//      decision time.
//   2. Swipes with no recorded exposure at all (e.g. a swipe logged through
//      a path that didn't also log an exposure, or exposure data purged
//      independently) are silently excluded from every calculation below —
//      they contribute to the platform's total swipe count elsewhere, but
//      not to this analysis. sampleSize on each row is the exposure-backed
//      subset, not the viewer's total swipe count.
//
// This is real behavioral profiling of identifiable people — restricted to
// is_platform_admin() by requirePlatformAdmin() below (no dedicated table,
// so no RLS to add; see migration 0204's comment on matchdeal_exposures/
// matchdeal_swipes for why that's still the correct enforcement point) and
// never surfaced on any investor/startup-facing page. Purely diagnostic —
// not wired to matching, scoring, or any user-visible feature (Prompt 297
// §3 documents this as a candidate signal only, in MATCHING_ENGINE_SPEC.md).
const MIN_SAMPLE = 3;

interface SwipeSample { targetProfileId: string; decisionSeconds: number; liked: boolean }

function avg(nums: number[]): number { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }
function likeRatePct(samples: SwipeSample[]): number {
  return samples.length ? Math.round((samples.filter((s) => s.liked).length / samples.length) * 1000) / 10 : 0;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: swipes } = await admin.from('matchdeal_swipes')
    .select('actor_profile_id, target_profile_id, direction, created_at');
  const { data: exposures } = await admin.from('matchdeal_exposures')
    .select('viewer_profile_id, shown_profile_id, shown_at');

  // Most recent prior exposure per (viewer, target) pair, keyed for O(1)
  // lookup per swipe — exposures come back unordered, so track the max.
  const latestExposureByPair = new Map<string, number>();
  for (const e of exposures ?? []) {
    const key = `${e.viewer_profile_id}::${e.shown_profile_id}`;
    const shownAt = new Date(e.shown_at as string).getTime();
    const cur = latestExposureByPair.get(key);
    if (cur === undefined || shownAt > cur) latestExposureByPair.set(key, shownAt);
  }

  const samplesByViewer = new Map<string, SwipeSample[]>();
  for (const s of swipes ?? []) {
    const viewerId = s.actor_profile_id as string;
    const targetId = s.target_profile_id as string;
    const exposedAt = latestExposureByPair.get(`${viewerId}::${targetId}`);
    if (exposedAt === undefined) continue; // no recorded exposure — excluded, per the header comment
    const swipedAt = new Date(s.created_at as string).getTime();
    const decisionSeconds = Math.max(0, Math.round((swipedAt - exposedAt) / 1000));
    const arr = samplesByViewer.get(viewerId) ?? [];
    arr.push({ targetProfileId: targetId, decisionSeconds, liked: s.direction === 'like' });
    samplesByViewer.set(viewerId, arr);
  }

  const targetProfileIds = [...new Set([...samplesByViewer.values()].flat().map((s) => s.targetProfileId))];
  const viewerProfileIds = [...samplesByViewer.keys()];
  const allProfileIds = [...new Set([...targetProfileIds, ...viewerProfileIds])];
  const { data: profiles } = allProfileIds.length
    ? await admin.from('matchdeal_profiles').select('id, kind, sectors, investment_stage_sought, company_phase, entity_name, representative_name')
      .in('id', allProfileIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  function stageOf(profileId: string): string | null {
    const p = profileById.get(profileId);
    if (!p) return null;
    return (p.kind === 'investor' ? p.investment_stage_sought : p.company_phase) as string | null;
  }
  function labelOf(profileId: string): string {
    const p = profileById.get(profileId);
    return (p?.entity_name as string) ?? (p?.representative_name as string) ?? 'Unknown';
  }

  const rows = [...samplesByViewer.entries()].map(([viewerId, samples]) => {
    const viewer = profileById.get(viewerId);
    const overallAvgDecisionSeconds = Math.round(avg(samples.map((s) => s.decisionSeconds)));
    const overallLikeRatePct = likeRatePct(samples);

    // Sector buckets — a target can belong to more than one sector, so a
    // sample can contribute to more than one bucket (documented, not a bug:
    // sectors is a real multi-value attribute on the target profile).
    const bySector = new Map<string, SwipeSample[]>();
    const byStage = new Map<string, SwipeSample[]>();
    for (const s of samples) {
      const target = profileById.get(s.targetProfileId);
      for (const sector of (target?.sectors as string[] | undefined) ?? []) {
        const arr = bySector.get(sector) ?? []; arr.push(s); bySector.set(sector, arr);
      }
      const stage = stageOf(s.targetProfileId);
      if (stage) { const arr = byStage.get(stage) ?? []; arr.push(s); byStage.set(stage, arr); }
    }

    type Candidate = { type: 'sector' | 'stage'; value: string; group: SwipeSample[] };
    const candidates: Candidate[] = [
      ...[...bySector.entries()].map(([value, group]) => ({ type: 'sector' as const, value, group })),
      ...[...byStage.entries()].map(([value, group]) => ({ type: 'stage' as const, value, group })),
    ].filter((c) => c.group.length >= MIN_SAMPLE);

    // No fabricated pattern when nothing clears the minimum sample bar —
    // "no clear pattern with available attributes" is a real, accepted answer.
    let topPattern = null as null | {
      type: 'sector' | 'stage'; value: string; sampleSize: number;
      avgDecisionSeconds: number; likeRatePct: number;
      elsewhereAvgDecisionSeconds: number; elsewhereLikeRatePct: number;
    };
    if (candidates.length) {
      // Largest sample first — the most statistically grounded pattern,
      // not the most dramatic-looking one.
      const best = candidates.sort((a, b) => b.group.length - a.group.length)[0];
      const groupTargetIds = new Set(best.group.map((s) => s.targetProfileId));
      const elsewhere = samples.filter((s) => !groupTargetIds.has(s.targetProfileId));
      topPattern = {
        type: best.type, value: best.value, sampleSize: best.group.length,
        avgDecisionSeconds: Math.round(avg(best.group.map((s) => s.decisionSeconds))),
        likeRatePct: likeRatePct(best.group),
        elsewhereAvgDecisionSeconds: Math.round(avg(elsewhere.map((s) => s.decisionSeconds))),
        elsewhereLikeRatePct: likeRatePct(elsewhere),
      };
    }

    return {
      viewerProfileId: viewerId, viewerKind: viewer?.kind as 'startup' | 'investor' | undefined,
      viewerLabel: labelOf(viewerId), sampleSize: samples.length,
      overallAvgDecisionSeconds, overallLikeRatePct, topPattern,
    };
  }).sort((a, b) => b.sampleSize - a.sampleSize);

  return NextResponse.json({ ok: true, minSample: MIN_SAMPLE, rows });
}
