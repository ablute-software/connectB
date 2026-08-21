import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { usageSessionsAvailable } from '@/lib/usage-sessions-capability';

// Prompt 297 §1 — MatchDeal usage ranking (standby vs active, accesses/day,
// usual hours of access), from usage_sessions (context='matchdeal', Prompt
// 295). Startup and investor participants are ranked SEPARATELY, never
// merged into one list — they're different roles in a two-sided market and
// mixing them would make neither ranking meaningful. Active/standby minutes
// are two numbers, never summed (explicit ask).
const WINDOW_DAYS = 30;

interface Agg { activeSeconds: number; standbySeconds: number; sessionCount: number; hours: number[] }

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await usageSessionsAvailable())) {
    return NextResponse.json({ ok: true, windowDays: WINDOW_DAYS, byKind: { startup: [], investor: [] }, hourlyHistogram: new Array(24).fill(0) });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const { data: sessions } = await admin.from('usage_sessions')
    .select('matchdeal_profile_id, active_seconds, standby_seconds, started_at')
    .eq('context', 'matchdeal').gte('started_at', since);

  const profileIds = [...new Set((sessions ?? []).map((s) => s.matchdeal_profile_id as string | null).filter((id): id is string => !!id))];
  const { data: profiles } = profileIds.length
    ? await admin.from('matchdeal_profiles').select('id, kind, membership_id, entity_name, representative_name').in('id', profileIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  // Resolve a human label per profile: startup → the org's own name;
  // investor → the linked catalog entity's name, falling back to whatever
  // entity_name/representative_name the profile itself carries.
  const startupMembershipIds = (profiles ?? []).filter((p) => p.kind === 'startup').map((p) => p.membership_id as string);
  const investorMembershipIds = (profiles ?? []).filter((p) => p.kind === 'investor').map((p) => p.membership_id as string);
  const [{ data: orgs }, { data: investorMembers }] = await Promise.all([
    startupMembershipIds.length ? admin.from('orgs').select('id, name').in('id', startupMembershipIds) : Promise.resolve({ data: [] }),
    investorMembershipIds.length ? admin.from('matchdeal_investor_members').select('id, catalog_entity_id').in('id', investorMembershipIds) : Promise.resolve({ data: [] }),
  ]);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const catalogEntityIdByMembership = new Map((investorMembers ?? []).map((m) => [m.id as string, m.catalog_entity_id as string]));
  const catalogEntityIds = [...catalogEntityIdByMembership.values()];
  const { data: catalogEntities } = catalogEntityIds.length
    ? await admin.from('catalog_entities').select('id, name').in('id', catalogEntityIds)
    : { data: [] };
  const catalogNameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));

  function labelFor(profileId: string): string {
    const p = profileById.get(profileId);
    if (!p) return 'Unknown profile';
    if (p.kind === 'startup') return orgNameById.get(p.membership_id as string) ?? (p.representative_name as string) ?? 'Unknown startup';
    const catalogEntityId = catalogEntityIdByMembership.get(p.membership_id as string);
    return (catalogEntityId && catalogNameById.get(catalogEntityId)) ?? (p.entity_name as string) ?? 'Unknown investor';
  }

  const byProfile = new Map<string, Agg>();
  const hourlyHistogram = new Array(24).fill(0);
  for (const s of sessions ?? []) {
    const profileId = s.matchdeal_profile_id as string | null;
    if (!profileId) continue;
    const cur = byProfile.get(profileId) ?? { activeSeconds: 0, standbySeconds: 0, sessionCount: 0, hours: new Array(24).fill(0) };
    cur.activeSeconds += (s.active_seconds as number) ?? 0;
    cur.standbySeconds += (s.standby_seconds as number) ?? 0;
    cur.sessionCount += 1;
    // Aggregated by UTC hour — no per-user timezone is stored anywhere in
    // this schema, so a local-hour histogram isn't honestly computable yet.
    // Documented simplification, not silently wrong.
    const hour = new Date(s.started_at as string).getUTCHours();
    cur.hours[hour] += 1;
    hourlyHistogram[hour] += 1;
    byProfile.set(profileId, cur);
  }

  function toRankRow(profileId: string, a: Agg) {
    return {
      profileId, label: labelFor(profileId),
      activeMinutes: Math.round(a.activeSeconds / 60), standbyMinutes: Math.round(a.standbySeconds / 60),
      accessesPerDay: Math.round((a.sessionCount / WINDOW_DAYS) * 100) / 100, sessionCount: a.sessionCount,
      hourlyHistogram: a.hours,
    };
  }

  const byKind = { startup: [] as ReturnType<typeof toRankRow>[], investor: [] as ReturnType<typeof toRankRow>[] };
  for (const [profileId, a] of byProfile.entries()) {
    const kind = profileById.get(profileId)?.kind as 'startup' | 'investor' | undefined;
    if (!kind) continue;
    byKind[kind].push(toRankRow(profileId, a));
  }
  byKind.startup.sort((a, b) => b.activeMinutes - a.activeMinutes);
  byKind.investor.sort((a, b) => b.activeMinutes - a.activeMinutes);

  return NextResponse.json({ ok: true, windowDays: WINDOW_DAYS, byKind, hourlyHistogram });
}
