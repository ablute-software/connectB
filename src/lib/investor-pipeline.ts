// Investor Workspace Pipeline (prompt 58) — extracted out of the route
// (prompt 62.4) so the CSV export can reuse the exact same waves/scores
// computation instead of re-deriving it; a second source of truth for
// "what's in my Pipeline" would drift.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';
import { eligibleOrgIds, resolveInvestorCatalogEntityId, resolveInvestorProfile } from './portal-access';

const WAVE_SIZE = 8;
const TRACKING_WINDOW_DAYS = 30;

// Prompt 62.3 — map of stage -> set of distinct investor profile ids who
// liked a startup at that stage in the last 30 days, excluding the caller.
// Deliberately never returns which startup, or any per-investor identity —
// only a count, grouped by stage, is ever read out of this map.
// No new index added for this — matchdeal_swipes is tiny at current scale
// (single-digit orgs on the platform). If this table grows large, an index
// on (direction, created_at) would keep this query cheap; flagging rather
// than adding pre-emptively.
async function computeTrackingCountsByStage(admin: SupabaseClient, excludeInvestorProfileId: string) {
  const since = new Date(Date.now() - TRACKING_WINDOW_DAYS * 86400000).toISOString();
  const { data: allStartupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id').eq('kind', 'startup');
  const { data: allOrgs } = await admin.from('orgs').select('id, stage');
  const stageByOrgId = new Map((allOrgs ?? []).map((o) => [o.id as string, o.stage as string | null]));
  const stageByProfileId = new Map((allStartupProfiles ?? []).map((p) => [p.id as string, stageByOrgId.get(p.membership_id as string) ?? null]));

  const { data: recentLikes } = await admin.from('matchdeal_swipes').select('actor_profile_id, target_profile_id')
    .eq('direction', 'like').gte('created_at', since).neq('actor_profile_id', excludeInvestorProfileId);

  const byStage = new Map<string, Set<string>>();
  for (const swipe of recentLikes ?? []) {
    const stage = stageByProfileId.get(swipe.target_profile_id as string);
    if (!stage) continue;
    if (!byStage.has(stage)) byStage.set(stage, new Set());
    byStage.get(stage)!.add(swipe.actor_profile_id as string);
  }
  return byStage;
}

export async function getPipelineWaves(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string) {
  const investorProfile = await resolveInvestorProfile(admin, userId);
  if (!investorProfile) return { linked: false as const };

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, userId, email, person?.id ?? null);
  const usualCoInvestors = (investorProfile as { usual_co_investors: string | null }).usual_co_investors;
  if (orgIds.length === 0) return { linked: true as const, waves: [], usualCoInvestors };

  const { data: orgs } = await admin.from('orgs').select(
    'id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country, round_valuation_eur',
  ).in('id', orgIds);
  const { data: startupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id')
    .eq('kind', 'startup').in('membership_id', orgIds);
  const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));

  const thesis: InvestorThesis = {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
  };

  const startupProfileIds = [...profileByOrg.values()];
  const { data: swipes } = startupProfileIds.length
    ? await admin.from('matchdeal_swipes').select('target_profile_id, direction, pass_reason')
      .eq('actor_profile_id', investorProfile.id).in('target_profile_id', startupProfileIds)
    : { data: [] as { target_profile_id: string; direction: string; pass_reason: string | null }[] };
  const swipeByStartupProfile = new Map((swipes ?? []).map((s) => [s.target_profile_id as string, s]));

  // AP-14 — investor_relationship_decisions is the org-level source of
  // truth (any teammate's decision must show the same status to every
  // other teammate); matchdeal_swipes above is per-user and only used as a
  // fallback for signals recorded before this table existed.
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  const { data: decisions } = investorCatalogEntityId && orgIds.length
    ? await admin.from('investor_relationship_decisions').select('org_id, decision, reason_detail')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).in('org_id', orgIds)
    : { data: [] as { org_id: string; decision: string; reason_detail: string | null }[] };
  const decisionByOrg = new Map((decisions ?? []).map((d) => [d.org_id as string, d]));

  // "Other investors tracking this" (prompt 62.3) — aggregated by stage
  // ACROSS THE WHOLE PLATFORM, never per-startup, and never resolved back to
  // an identity: the privacy limit from Prompt 61's scoping is non-negotiable
  // ("nunca expor o deal flow individual de outro investidor"). Two queries
  // regardless of how many cards there are — not one per card.
  const trackingCountByStage = await computeTrackingCountsByStage(admin, investorProfile.id);

  const cards = (orgs ?? []).map((org) => {
    const round: StartupRound = {
      sectors: org.sectors ?? [], stage: org.stage, country: org.country,
      roundTargetEur: org.round_target_eur, roundMinTicketEur: org.round_min_ticket_eur,
      roundInstruments: org.round_instruments ?? [],
    };
    const { score, reasons } = computeMatchScore(thesis, round);
    const startupProfileId = profileByOrg.get(org.id as string) ?? null;
    const swipe = startupProfileId ? swipeByStartupProfile.get(startupProfileId) : null;
    const decision = decisionByOrg.get(org.id as string);
    const status = decision
      ? (decision.decision === 'passed' ? 'passed' : 'interested')
      : (swipe?.direction === 'pass' ? 'passed' : swipe?.direction === 'like' ? 'interested' : 'open');
    return {
      orgId: org.id, name: org.name, oneLiner: org.one_liner, sectors: org.sectors ?? [], stage: org.stage,
      hqCity: org.hq_city, country: org.country, roundTargetEur: org.round_target_eur,
      roundValuationEur: org.round_valuation_eur,
      roundInstruments: org.round_instruments ?? [], matchScore: score, matchReasons: reasons,
      status, passReason: decision ? decision.reason_detail : (swipe?.pass_reason ?? null),
      trackingCount: org.stage ? (trackingCountByStage.get(org.stage as string)?.size ?? 0) : 0,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);

  const waves = [];
  for (let i = 0; i < cards.length; i += WAVE_SIZE) {
    const items = cards.slice(i, i + WAVE_SIZE);
    const priorTreated = cards.slice(0, i).every((c) => c.status !== 'open');
    waves.push({ index: waves.length, items, unlocked: i === 0 || priorTreated });
  }

  return { linked: true as const, waves, usualCoInvestors };
}
