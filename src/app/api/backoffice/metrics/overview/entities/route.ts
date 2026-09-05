import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { resolvePeriod, relevantActivityOrgIds, type Period } from '@/lib/backoffice-metrics';
import { isExcludedOrgName } from '@/lib/analytics-events';
import { usageSessionsAvailable } from '@/lib/usage-sessions-capability';

// Prompt 296 §2 — "Ver quem são" drill-down, originally wired for the two
// Overview cards that represent an identifiable SET of real orgs rather than
// a rate or aggregate (New startups, Startups with active round). Prompt 569
// §4 added a third: Relevant activity, via relevantActivityOrgIds — the same
// set-building function startupsWithRelevantActivity() itself calls, so this
// list can never drift into a second, looser definition of "relevant
// activity" than the number above it. usage_sessions time-in-session
// (Prompt 295) is attached only when at least one real session row exists
// for the org; never fabricated or estimated when absent.
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const metric = searchParams.get('metric');
  const period = (searchParams.get('period') as Period) || '30d';

  const { data: allOrgs } = await admin.from('orgs').select('id, name, created_at, round_raising');
  const realOrgs = (allOrgs ?? []).filter((o) => !isExcludedOrgName(o.name as string));

  let orgs: { id: string; name: string; created_at: string }[];
  if (metric === 'newStartups') {
    const { current } = resolvePeriod(period);
    const from = current.from.getTime(), to = current.to.getTime();
    orgs = realOrgs.filter((o) => {
      const t = new Date(o.created_at as string).getTime();
      return t >= from && t < to;
    }) as { id: string; name: string; created_at: string }[];
  } else if (metric === 'activeFundraisingStartups') {
    orgs = realOrgs.filter((o) => o.round_raising === true) as { id: string; name: string; created_at: string }[];
  } else if (metric === 'startupsWithRelevantActivity') {
    const { current } = resolvePeriod(period);
    const activeIds = await relevantActivityOrgIds(admin, current);
    orgs = realOrgs.filter((o) => activeIds.has(o.id as string)) as { id: string; name: string; created_at: string }[];
  } else {
    return NextResponse.json({ ok: false, error: 'unsupported metric for this drill-down.' }, { status: 400 });
  }
  orgs = [...orgs].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const usageByOrg = new Map<string, { activeSeconds: number; sessionCount: number }>();
  if (await usageSessionsAvailable()) {
    const orgIds = orgs.map((o) => o.id);
    const { data: sessions } = orgIds.length
      ? await admin.from('usage_sessions').select('org_id, active_seconds').eq('context', 'crm').in('org_id', orgIds)
      : { data: [] };
    for (const s of sessions ?? []) {
      const orgId = s.org_id as string | null;
      if (!orgId) continue;
      const cur = usageByOrg.get(orgId) ?? { activeSeconds: 0, sessionCount: 0 };
      cur.activeSeconds += (s.active_seconds as number) ?? 0;
      cur.sessionCount += 1;
      usageByOrg.set(orgId, cur);
    }
  }

  const items = orgs.map((o) => {
    const usage = usageByOrg.get(o.id);
    return {
      orgId: o.id,
      name: o.name,
      createdAt: o.created_at,
      // null (not 0) when no session row exists at all — an honest "no
      // usage data yet" rather than a fabricated zero.
      timeInSessionMinutes: usage ? Math.round(usage.activeSeconds / 60) : null,
      sessionCount: usage?.sessionCount ?? null,
    };
  });

  return NextResponse.json({ ok: true, items });
}
