import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { usageSessionsAvailable } from '@/lib/usage-sessions-capability';
import { isExcludedOrgName } from '@/lib/analytics-events';

// Prompt 296 §4 — general usage ranking, by org and by person, from
// usage_sessions (Prompt 295). Scoped to context='crm' only: 'backoffice'
// is a handful of platform staff (a ranking adds no signal), and 'matchdeal'
// gets its OWN dedicated ranking in Prompt 297 (with standby/active split
// per participant kind, which this route doesn't need to duplicate).
// Fixed 30-day window, no period picker — matches Prompt 295's own heartbeat
// design (a session already ends when its tab goes hidden, so "last 30
// days of sessions" is a stable, honest window without needing UI for it.
const WINDOW_DAYS = 30;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await usageSessionsAvailable())) return NextResponse.json({ ok: true, byOrg: [], byPerson: [] });

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const { data: sessions } = await admin.from('usage_sessions')
    .select('org_id, user_id, active_seconds, standby_seconds, started_at')
    .eq('context', 'crm').gte('started_at', since);

  const { data: orgs } = await admin.from('orgs').select('id, name');
  const orgNameById = new Map((orgs ?? []).filter((o) => !isExcludedOrgName(o.name as string)).map((o) => [o.id, o.name as string]));

  interface Agg { activeSeconds: number; standbySeconds: number; sessionCount: number; days: Set<string> }
  const byOrg = new Map<string, Agg>();
  const byPerson = new Map<string, Agg>();

  for (const s of sessions ?? []) {
    const orgId = s.org_id as string | null;
    const userId = s.user_id as string | null;
    // Excluded test orgs never contribute rows to either ranking — an org
    // and its members are the same exclusion decision.
    if (orgId && !orgNameById.has(orgId)) continue;
    const day = (s.started_at as string).slice(0, 10);
    const active = (s.active_seconds as number) ?? 0;
    const standby = (s.standby_seconds as number) ?? 0;

    if (orgId) {
      const cur = byOrg.get(orgId) ?? { activeSeconds: 0, standbySeconds: 0, sessionCount: 0, days: new Set<string>() };
      cur.activeSeconds += active; cur.standbySeconds += standby; cur.sessionCount += 1; cur.days.add(day);
      byOrg.set(orgId, cur);
    }
    if (userId) {
      const cur = byPerson.get(userId) ?? { activeSeconds: 0, standbySeconds: 0, sessionCount: 0, days: new Set<string>() };
      cur.activeSeconds += active; cur.standbySeconds += standby; cur.sessionCount += 1; cur.days.add(day);
      byPerson.set(userId, cur);
    }
  }

  const byOrgRanked = [...byOrg.entries()]
    .map(([orgId, a]) => ({
      orgId, orgName: orgNameById.get(orgId) ?? 'Unknown org',
      activeMinutes: Math.round(a.activeSeconds / 60), standbyMinutes: Math.round(a.standbySeconds / 60),
      accessesPerDay: Math.round((a.sessionCount / WINDOW_DAYS) * 100) / 100, sessionCount: a.sessionCount,
    }))
    .sort((a, b) => b.activeMinutes - a.activeMinutes);

  // Person names come from Supabase Auth, not a cached table — org_members
  // stores no email/name of its own, and this is a backoffice-only
  // admin view, so the per-request auth.admin lookup cost is acceptable.
  const byPersonRanked = await Promise.all([...byPerson.entries()]
    .sort((a, b) => b[1].activeSeconds - a[1].activeSeconds)
    .map(async ([userId, a]) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return {
        userId, email: data?.user?.email ?? 'Unknown',
        activeMinutes: Math.round(a.activeSeconds / 60), standbyMinutes: Math.round(a.standbySeconds / 60),
        accessesPerDay: Math.round((a.sessionCount / WINDOW_DAYS) * 100) / 100, sessionCount: a.sessionCount,
      };
    }));

  return NextResponse.json({ ok: true, windowDays: WINDOW_DAYS, byOrg: byOrgRanked, byPerson: byPersonRanked });
}
