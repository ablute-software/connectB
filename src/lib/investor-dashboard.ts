import 'server-only';
// Prompt 340 Block A — investor Dashboard tab. Aggregates ONLY the
// investor's own data (their own pipeline, their own decisions, their own
// follow-on signals) — never anything comparative between startups, never
// anything derived about a founder beyond what's already visible to this
// investor elsewhere (root privacy rule, CLAUDE.md). Every field here is a
// reuse of an existing, already-gated computation:
//   - byStatus/byLevel: getPipelineWaves' own card.status + the same
//     currentInterestLevel/getInterestLevelRows loop access-granted/route.ts
//     already runs per-org (no batched version exists anywhere — see the
//     Prompt 340 research note in that route's own history).
//   - roundCloses: the exact same eligibleOrgIds + orgs.round_target_close_date
//     read investor-agenda.ts and /api/portal/today already expose to this
//     investor with NO P136 level gate — aggregating it here reveals nothing
//     Agenda/Today don't already show.
//   - followOn: getInvestedRelationshipsForInvestor (network-followon-db.ts),
//     filtered to active signals — the investor's own management view.
//   - recentActivity: the investor's own decisions + the same 7-day
//     Q&A-answered window /api/portal/today already computes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPipelineWaves } from './investor-pipeline';
import { eligibleOrgIds, resolveInvestorCatalogEntityId } from './portal-access';
import { currentInterestLevel, type InterestLevel } from './investor-interest-level';
import { getInterestLevelRows } from './investor-interest-level-db';
import { interestLevelAvailable } from './investor-interest-level-capability';
import { getInvestedRelationshipsForInvestor } from './network-followon-db';

const ANSWERED_RECENTLY_DAYS = 7;

export interface DashboardFunnel { byStatus: { open: number; interested: number; passed: number }; byLevel: Record<InterestLevel, number> }
export interface DashboardRoundClose { orgId: string; orgName: string; date: string }
export interface DashboardFollowOn { orgId: string; orgName: string; expiresAt: string | null }
export interface DashboardActivityItem { kind: 'decision' | 'qa_answered'; title: string; orgId: string; at: string }
export interface DashboardData {
  linked: boolean;
  funnel: DashboardFunnel | null;
  roundCloses: DashboardRoundClose[];
  followOn: DashboardFollowOn[];
  recentActivity: DashboardActivityItem[];
}

export async function getDashboardData(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string): Promise<DashboardData> {
  const empty: DashboardData = { linked: false, funnel: null, roundCloses: [], followOn: [], recentActivity: [] };
  const pipeline = await getPipelineWaves(sb, admin, userId, email);
  if (!pipeline.linked) return empty;

  const cards = pipeline.waves.flatMap((w) => w.items);
  const byStatus = { open: 0, interested: 0, passed: 0 };
  for (const c of cards) byStatus[c.status as 'open' | 'interested' | 'passed']++;

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  const byLevel: Record<InterestLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  if (investorCatalogEntityId && cards.length > 0 && await interestLevelAvailable()) {
    const orgIds = cards.map((c) => c.orgId);
    const { data: decisionRows } = await admin.from('investor_relationship_decisions')
      .select('org_id, decision').eq('investor_catalog_entity_id', investorCatalogEntityId).in('org_id', orgIds);
    const decisionByOrg = new Map((decisionRows ?? []).map((r) => [r.org_id as string, r.decision as 'interested' | 'passed']));
    await Promise.all(orgIds.map(async (orgId) => {
      const levelRows = await getInterestLevelRows(admin, orgId, investorCatalogEntityId);
      const level = currentInterestLevel(decisionByOrg.get(orgId) ?? null, levelRows);
      byLevel[level]++;
    }));
  }

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, userId, email, person?.id ?? null);
  const roundCloses: DashboardRoundClose[] = [];
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from('orgs').select('id, name, round_target_close_date').in('id', orgIds).not('round_target_close_date', 'is', null);
    for (const o of orgs ?? []) roundCloses.push({ orgId: o.id as string, orgName: o.name as string, date: o.round_target_close_date as string });
    roundCloses.sort((a, b) => a.date.localeCompare(b.date));
  }

  let followOn: DashboardFollowOn[] = [];
  if (investorCatalogEntityId) {
    const relationships = await getInvestedRelationshipsForInvestor(admin, investorCatalogEntityId);
    followOn = relationships.filter((r) => r.hasActiveSignal).map((r) => ({ orgId: r.orgId, orgName: r.orgName, expiresAt: r.expiresAt }));
  }

  const recentActivity: DashboardActivityItem[] = [];
  if (investorCatalogEntityId) {
    const { data: decided } = await admin.from('investor_relationship_decisions')
      .select('org_id, decision, decided_at').eq('investor_catalog_entity_id', investorCatalogEntityId)
      .not('decided_at', 'is', null).order('decided_at', { ascending: false }).limit(10);
    const decisionOrgIds = [...new Set((decided ?? []).map((d) => d.org_id as string))];
    const { data: decisionOrgs } = decisionOrgIds.length ? await admin.from('orgs').select('id, name').in('id', decisionOrgIds) : { data: [] };
    const decisionOrgName = new Map((decisionOrgs ?? []).map((o) => [o.id as string, o.name as string]));
    for (const d of decided ?? []) {
      const orgName = decisionOrgName.get(d.org_id as string) ?? 'A startup';
      recentActivity.push({ kind: 'decision', orgId: d.org_id as string, at: d.decided_at as string, title: `You marked ${orgName} as ${d.decision}` });
    }
  }
  const { data: answered } = await admin.from('portal_questions').select('org_id, question, answered_at')
    .eq('asked_by_email', email).not('answered_at', 'is', null)
    .gte('answered_at', new Date(Date.now() - ANSWERED_RECENTLY_DAYS * 86400000).toISOString());
  if (answered && answered.length > 0) {
    const qaOrgIds = [...new Set(answered.map((a) => a.org_id as string))];
    const { data: qaOrgs } = await admin.from('orgs').select('id, name').in('id', qaOrgIds);
    const qaOrgName = new Map((qaOrgs ?? []).map((o) => [o.id as string, o.name as string]));
    for (const a of answered) {
      recentActivity.push({ kind: 'qa_answered', orgId: a.org_id as string, at: a.answered_at as string, title: `${qaOrgName.get(a.org_id as string) ?? 'A startup'} answered your question` });
    }
  }
  recentActivity.sort((a, b) => b.at.localeCompare(a.at));

  return { linked: true, funnel: { byStatus, byLevel }, roundCloses, followOn, recentActivity: recentActivity.slice(0, 15) };
}
