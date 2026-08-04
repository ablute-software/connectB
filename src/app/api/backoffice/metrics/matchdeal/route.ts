// Prompt 124 §2 (Block A) — MatchDeal's own metrics tab. The counters
// already exist in real tables (matchdeal_swipes, matchdeal_matches,
// matchdeal_pairings, matchdeal_weekly_activity) — they just never had a
// screen. Read-only: no writes, no touches to the matching engine itself.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const DAYS_FOR_RATE = 7;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const since = new Date(Date.now() - DAYS_FOR_RATE * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: weekStartRow }, { count: swipesLastWeek }, { count: likesLastWeek }, { count: passesLastWeek },
    { count: activeMatches }, { data: pairings }, { data: profiles },
  ] = await Promise.all([
    admin.rpc('matchdeal_current_week_start'),
    admin.from('matchdeal_swipes').select('id', { count: 'exact', head: true }).gte('created_at', since),
    admin.from('matchdeal_swipes').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('direction', 'like'),
    admin.from('matchdeal_swipes').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('direction', 'pass'),
    admin.from('matchdeal_matches').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('matchdeal_pairings').select('kind, status'),
    admin.from('matchdeal_profiles').select('id, kind, plan_tier'),
  ]);

  const activePairingsByKind = { startup: 0, investor: 0 };
  for (const p of pairings ?? []) if (p.status === 'active') activePairingsByKind[p.kind as 'startup' | 'investor']++;

  const weekStart = weekStartRow as string | null;
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  const tierByProfile = new Map((profiles ?? []).map((p) => [p.id as string, p.plan_tier as string]));

  const { data: weeklyActivity } = weekStart && profileIds.length
    ? await admin.from('matchdeal_weekly_activity').select('profile_id, shown_count, like_count, undo_count').eq('week_start', weekStart).in('profile_id', profileIds)
    : { data: [] };

  const byTier: Record<string, { profiles: number; shown: number; likes: number; reconsiderations: number }> = {};
  for (const row of weeklyActivity ?? []) {
    const tier = tierByProfile.get(row.profile_id as string) ?? 'unknown';
    if (!byTier[tier]) byTier[tier] = { profiles: 0, shown: 0, likes: 0, reconsiderations: 0 };
    byTier[tier].profiles++;
    byTier[tier].shown += (row.shown_count as number) ?? 0;
    byTier[tier].likes += (row.like_count as number) ?? 0;
    byTier[tier].reconsiderations += (row.undo_count as number) ?? 0;
  }

  return NextResponse.json({
    ok: true,
    swipesPerDay: Math.round(((swipesLastWeek ?? 0) / DAYS_FOR_RATE) * 10) / 10,
    likesLastWeek: likesLastWeek ?? 0,
    passesLastWeek: passesLastWeek ?? 0,
    activeMatches: activeMatches ?? 0,
    activePairings: activePairingsByKind,
    weekStart,
    usageByTier: byTier,
  });
}
