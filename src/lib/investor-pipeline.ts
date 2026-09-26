// Investor Workspace Pipeline (prompt 58) — extracted out of the route
// (prompt 62.4) so the CSV export can reuse the exact same waves/scores
// computation instead of re-deriving it; a second source of truth for
// "what's in my Pipeline" would drift.
//
// Prompt 687 — getPipelineWaves used to run roughly twenty Supabase round
// trips ONE AFTER ANOTHER, most of them with no real dependency on each
// other at all (measured live: 10-30s to load a Pipeline of THREE
// startups, vs ~4s before Prompt 681/683 added the taxonomy's extra
// reads). Restructured into a small number of explicit stages, each stage
// a Promise.all of everything that only needs what a PRIOR stage already
// produced — never sequential just because the code happened to be
// written top to bottom. Every stage is timed (pipeline-timing.ts,
// `[pipeline-timing]` in the logs) so a future regression shows up by
// stage name instead of being re-discovered live.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';
import { closedOrgIds } from './org-closed';
import { projectUnavailableCard } from './closed-org-card';
import { activeGrantOrgIds, eligiblePipelineOrgIds, resolveInvestorCatalogEntityId, resolveInvestorPlanTierForProfile, resolveInvestorProfile, resolveViewerIsTest } from './portal-access';
import { HYPE_GATE_PLAN_TIER } from './matchdeal-hype';
import { pipelineTestFlagAvailable } from './pipeline-test-flag-capability';
import { roundValuationBasisAvailable } from './round-valuation-basis-capability';
import { investorPlanRow } from './plans';
import { resolveActorDisplays } from './network-db';
import { getActiveFollowOnPairs } from './network-followon-db';
import { shapeFollowOnPayload, type FollowOnPayload } from './network';
import { projectIntroPitch } from './investor-interest-level';
import { canWithdrawInterest, resolveWithdrawWindowSignals } from './investor-interest-withdrawal';
import { interactionLogAvailable } from './investor-interaction-log-capability';
import { buildPipelineWaves } from './pipeline-waves';
import type { PipelineQuota } from './pipeline-quota-line';
import { calendarMonthStartIso, computeAdmissions, computeReservationTargets } from './pipeline-admissions';
import { investorPipelineStage, investorPipelineStageDetail, type InvestorPipelineStage } from './investor-pipeline-stage';
import { computeEvaluationTraceOrgIds } from './investor-evaluation-trace';
import { hasPortfolioRelationship } from './investor-portfolio-relationship';
import { timeBlock } from './pipeline-timing';
import { findOrOpenEpisode, isFirmTestOrInternal, writeSignalEvent } from './investor-signal-events';
import { isVisibleToOthers, type ModerationStatus } from './account-moderation';
import { getInvestorContext, isPauseActive } from './investor-context';
import { reevaluationAlertsAvailable } from './reevaluation-capability';
import { conditionKindLabel, reapresentationMessage, type ConditionKind } from './reevaluation-conditions';
import {
  fetchReevaluationCandidates, fulfillDateConditions, isOutOfCurrentMandate,
  markReevaluationRepresented, selectReevaluationsToPresent,
} from './reevaluation-presentation';

const TRACKING_WINDOW_DAYS = 30;

// Prompt 62.3 — map of stage -> set of distinct investor profile ids who
// liked a startup at that stage in the last 30 days, excluding the caller.
// Deliberately never returns which startup, or any per-investor identity —
// only a count, grouped by stage, is ever read out of this map.
// No new index added for this — matchdeal_swipes is tiny at current scale
// (single-digit orgs on the platform). If this table grows large, an index
// on (direction, created_at) would keep this query cheap; flagging rather
// than adding pre-emptively.
//
// Item #15 — this aggregates ACROSS every investor and startup on the
// platform, which is exactly where internal/QA activity is most invisible
// to spot and most damaging to trust ("6 other investors are tracking
// this" counting the team's own dogfood swipes). Two independent filters,
// both no-ops until migration 0139 lands: startups whose org is_test never
// contribute a target stage, and investor actors whose catalog_entity
// is_test never contribute a like.
//
// Prompt 687 — the three queries below (allStartupProfiles, allOrgs,
// recentLikes) have no dependency on each other; only
// testInvestorActorProfileIds genuinely needs recentLikes' own result.
async function computeTrackingCountsByStage(admin: SupabaseClient, excludeInvestorProfileId: string) {
  const since = new Date(Date.now() - TRACKING_WINDOW_DAYS * 86400000).toISOString();
  const testFlagAvailable = await pipelineTestFlagAvailable();

  const [{ data: allStartupProfiles }, { data: allOrgs }, { data: recentLikes }] = await timeBlock('trackingCounts.reads', () => Promise.all([
    admin.from('matchdeal_profiles').select('id, membership_id').eq('kind', 'startup'),
    testFlagAvailable ? admin.from('orgs').select('id, stage, is_test') : admin.from('orgs').select('id, stage'),
    admin.from('matchdeal_swipes').select('actor_profile_id, target_profile_id')
      .eq('direction', 'like').gte('created_at', since).neq('actor_profile_id', excludeInvestorProfileId),
  ]));
  const stageByOrgId = new Map((allOrgs ?? []).map((o) => [o.id as string, o.stage as string | null]));
  const testOrgIds = new Set((allOrgs ?? []).filter((o) => (o as { is_test?: boolean }).is_test).map((o) => o.id as string));
  const stageByProfileId = new Map(
    (allStartupProfiles ?? [])
      .filter((p) => !testOrgIds.has(p.membership_id as string))
      .map((p) => [p.id as string, stageByOrgId.get(p.membership_id as string) ?? null]),
  );

  const testActorProfileIds = testFlagAvailable
    ? await testInvestorActorProfileIds(admin, (recentLikes ?? []).map((s) => s.actor_profile_id as string))
    : new Set<string>();

  const byStage = new Map<string, Set<string>>();
  for (const swipe of recentLikes ?? []) {
    if (testActorProfileIds.has(swipe.actor_profile_id as string)) continue;
    const stage = stageByProfileId.get(swipe.target_profile_id as string);
    if (!stage) continue;
    if (!byStage.has(stage)) byStage.set(stage, new Set());
    byStage.get(stage)!.add(swipe.actor_profile_id as string);
  }
  return byStage;
}

// Item #15 — an investor matchdeal_profile's membership_id points at
// matchdeal_investor_members.id, which in turn carries the firm-level
// catalog_entity_id (0053) — is_test lives on catalog_entities, two hops
// away from the profile id a swipe row actually stores.
async function testInvestorActorProfileIds(admin: SupabaseClient, actorProfileIds: string[]): Promise<Set<string>> {
  const uniqueActorIds = [...new Set(actorProfileIds)];
  if (uniqueActorIds.length === 0) return new Set();

  const { data: actorProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id')
    .in('id', uniqueActorIds).eq('kind', 'investor');
  const memberIds = [...new Set((actorProfiles ?? []).map((p) => p.membership_id as string))];
  if (memberIds.length === 0) return new Set();

  const { data: members } = await admin.from('matchdeal_investor_members').select('id, catalog_entity_id').in('id', memberIds);
  const catalogIdByMemberId = new Map((members ?? []).map((m) => [m.id as string, m.catalog_entity_id as string]));
  const catalogIds = [...new Set((members ?? []).map((m) => m.catalog_entity_id as string))];
  if (catalogIds.length === 0) return new Set();

  const { data: testCatalogEntities } = await admin.from('catalog_entities').select('id').eq('is_test', true).in('id', catalogIds);
  const testCatalogIds = new Set((testCatalogEntities ?? []).map((c) => c.id as string));

  return new Set(
    (actorProfiles ?? [])
      .filter((p) => testCatalogIds.has(catalogIdByMemberId.get(p.membership_id as string) ?? ''))
      .map((p) => p.id as string),
  );
}

// Prompt 318 — a THIRD relationship source, alongside grants/decisions: an
// accepted My Network referral (network_referrals, state='accepted') that
// named this investor as its target. accepted itself is durable consent —
// no separate admissions-table write, network_referrals already IS the
// record (Prompt 318's own explicit design preference). Resolves the
// investor's own network_actors row from their matchdeal_profiles id (the
// same identity every other My Network read keys off).
async function acceptedReferralsForInvestor(admin: SupabaseClient, investorMatchdealProfileId: string) {
  const { data: actorRow } = await timeBlock('referrals.actor', () => admin.from('network_actors').select('id').eq('matchdeal_profile_id', investorMatchdealProfileId).maybeSingle());
  const investorActorId = actorRow?.id as string | undefined;
  if (!investorActorId) return { orgIds: [] as string[], referrerNameByOrgId: new Map<string, string>() };

  const { data: accepted } = await timeBlock('referrals.accepted', () => admin.from('network_referrals')
    .select('referred_org_id, referrer_actor_id').eq('target_actor_id', investorActorId).eq('state', 'accepted'));
  const rows = accepted ?? [];
  const referrerNameByOrgId = new Map<string, string>();
  if (rows.length > 0) {
    const displays = await resolveActorDisplays(admin, [...new Set(rows.map((r) => r.referrer_actor_id as string))]);
    for (const r of rows) {
      const name = displays.get(r.referrer_actor_id as string)?.name;
      if (name) referrerNameByOrgId.set(r.referred_org_id as string, name);
    }
  }
  return { orgIds: rows.map((r) => r.referred_org_id as string), referrerNameByOrgId };
}

// Prompt 683 — a startup whose founder already recorded THIS investor as
// `invested` in their own pipeline. catalog_deliveries is the existing
// link between a founder's CRM entity and the investor's catalog_entity_id
// (the same table the interest-level request task already resolves
// through) — reused here, not a new relationship mechanism. Batched: two
// queries regardless of how many orgs this investor's firm has ever been
// delivered to.
async function portfolioOrgIds(admin: SupabaseClient, investorCatalogEntityId: string): Promise<Set<string>> {
  const { data: deliveries } = await timeBlock('portfolio.deliveries', () => admin.from('catalog_deliveries').select('org_id, entity_id').eq('catalog_id', investorCatalogEntityId));
  const rows = deliveries ?? [];
  if (rows.length === 0) return new Set();
  const { data: entityRows } = await timeBlock('portfolio.entities', () => admin.from('entities').select('id, status').in('id', rows.map((r) => r.entity_id as string)));
  const statusById = new Map((entityRows ?? []).map((e) => [e.id as string, e.status as string | null]));
  const statusesByOrg = new Map<string, (string | null)[]>();
  for (const r of rows) {
    const orgId = r.org_id as string;
    statusesByOrg.set(orgId, [...(statusesByOrg.get(orgId) ?? []), statusById.get(r.entity_id as string) ?? null]);
  }
  const result = new Set<string>();
  for (const [orgId, statuses] of statusesByOrg) if (hasPortfolioRelationship(statuses)) result.add(orgId);
  return result;
}

// P132-A — the ID-only half of the union, for callers (the POST action
// route) that just need a membership check, not the full card data
// getPipelineWaves builds. See that function's own header comment for the
// full "why a union" reasoning; kept in sync with it deliberately (both
// read the same four sources), not re-derived independently. This one is
// called far less often (one decision at a time, never a page load) so it
// keeps its original straight-line shape rather than the staged rewrite
// below — nothing here was ever reported slow.
export async function pipelineEligibleOrgIds(admin: SupabaseClient, userId: string, email: string, personId: string | null): Promise<string[]> {
  const [granted, investorCatalogEntityId, investorProfile] = await Promise.all([
    activeGrantOrgIds(admin, email, personId),
    resolveInvestorCatalogEntityId(admin, userId),
    resolveInvestorProfile(admin, userId),
  ]);
  const viewerIsTest = await resolveViewerIsTest(admin, investorCatalogEntityId);
  const published = await eligiblePipelineOrgIds(admin, viewerIsTest);
  const { data: decisions } = investorCatalogEntityId
    ? await admin.from('investor_relationship_decisions').select('org_id').eq('investor_catalog_entity_id', investorCatalogEntityId)
    : { data: [] as { org_id: string }[] };
  const { orgIds: referredOrgIds } = investorProfile ? await acceptedReferralsForInvestor(admin, investorProfile.id as string) : { orgIds: [] as string[] };
  const portfolio = investorCatalogEntityId ? await portfolioOrgIds(admin, investorCatalogEntityId) : new Set<string>();
  return [...new Set([...published, ...granted, ...(decisions ?? []).map((d) => d.org_id as string), ...referredOrgIds, ...portfolio])];
}

// Prompt 850 §C moved isTreatedForWaveDosage (and WAVE_SIZE) to
// pipeline-waves.ts, where the rest of the wave mechanics now live.
// Re-exported here because that is where every existing caller imports it
// from — the function itself is unchanged.
export { isTreatedForWaveDosage } from './pipeline-waves';

type Decision = { org_id: string; decision: string; reason_detail: string | null; decided_at: string; decided_by: string };
type LevelRow = { org_id: string; level: 2 | 3; status: 'granted' | 'pending' | 'denied' };

// Prompt 742 §B.1 — the access check document-picker was missing entirely
// (any signed-in user could pass any orgId and read back that org's
// on_grant/due_diligence document NAMES). Cheap check first: an active
// data-room grant already covers the common real case for "picking a
// document to request" without paying for a full pipeline computation.
// Only falls through to the dossier's own (expensive — see this file's own
// Prompt 687 comment above) getPipelineWaves when that's not enough, so a
// caller with a real grant never pays for it.
export async function canViewStartup(
  sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string, personId: string | null, orgId: string,
): Promise<boolean> {
  const grantedOrgIds = await activeGrantOrgIds(admin, email, personId);
  if (grantedOrgIds.includes(orgId)) return true;
  const result = await getPipelineWaves(sb, admin, userId, email);
  return result.linked ? result.waves.flatMap((w) => w.items).some((c) => c.orgId === orgId) : false;
}

export async function getPipelineWaves(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string) {
  const pipelineStart = Date.now();
  const investorProfile = await timeBlock('investorProfile', () => resolveInvestorProfile(admin, userId));
  if (!investorProfile) return { linked: false as const };

  // Stage 1, wave A — everything that depends on nothing but userId/email/
  // investorProfile.id, which are all already in hand. computeTrackingCountsByStage
  // in particular has no dependency on orgIds at all (it aggregates across the
  // whole platform, not this investor's own eligible set) and used to run
  // near the very end, sequentially, for no reason.
  const [
    personResult, investorCatalogEntityId, referralsResult, viewerPlanTier, trackingCountByStage,
  ] = await timeBlock('stage1.waveA', () => Promise.all([
    admin.from('people').select('id').eq('email_verified', email).maybeSingle(),
    resolveInvestorCatalogEntityId(admin, userId),
    acceptedReferralsForInvestor(admin, investorProfile.id as string),
    resolveInvestorPlanTierForProfile(admin, investorProfile.id as string),
    computeTrackingCountsByStage(admin, investorProfile.id as string),
  ]));
  const person = personResult.data;
  const { orgIds: referredOrgIdsViaReferral, referrerNameByOrgId } = referralsResult;
  const referredOrgIdsViaReferralSet = new Set(referredOrgIdsViaReferral);

  // Stage 1, wave B — needs person.id / investorCatalogEntityId from wave A.
  // P132-A eligibility union sources: an active data-room grant, a recorded
  // decision, and (Prompt 683) a portfolio investment.
  const [grantedOrgIdList, viewerIsTest, decisionsResult, portfolioOrgIdsSet] = await timeBlock('stage1.waveB', () => Promise.all([
    activeGrantOrgIds(admin, email, person?.id ?? null),
    resolveViewerIsTest(admin, investorCatalogEntityId),
    investorCatalogEntityId
      ? admin.from('investor_relationship_decisions').select('org_id, decision, reason_detail, decided_at, decided_by').eq('investor_catalog_entity_id', investorCatalogEntityId)
      : Promise.resolve({ data: [] as Decision[] }),
    investorCatalogEntityId ? portfolioOrgIds(admin, investorCatalogEntityId) : Promise.resolve(new Set<string>()),
  ]));
  const grantedOrgIds = new Set(grantedOrgIdList);
  const decisionByOrg = new Map((decisionsResult.data ?? []).map((d) => [d.org_id, d]));
  const decidedOrgIds = new Set(decisionByOrg.keys());

  // publishedOrgIds genuinely needs viewerIsTest from wave B — the one
  // real sequential step left in this half of the function.
  const publishedOrgIds = await timeBlock('publishedOrgIds', () => eligiblePipelineOrgIds(admin, viewerIsTest));

  // P132-A — Pipeline eligibility is a UNION of two populations, per Nuno's
  // own product definition ("all the companies the app understands could
  // fit the mandate, before and after being contacted"):
  //   A. A real relationship with THIS investor — an active data-room
  //      grant (the founder's own consent to invite them in), an
  //      already-recorded decision (interested/passed — history, never
  //      disappears even if the startup's MatchDeal profile later gets
  //      unpublished), an accepted referral, or (Prompt 683) a founder-
  //      recorded portfolio investment.
  //   B. Discovery — published MatchDeal profiles matching the mandate
  //      (P120-A, unchanged).
  const orgIds = [...new Set([...publishedOrgIds, ...grantedOrgIdList, ...decidedOrgIds, ...referredOrgIdsViaReferral, ...portfolioOrgIdsSet])];
  const usualCoInvestors = (investorProfile as { usual_co_investors: string | null }).usual_co_investors;
  if (orgIds.length === 0) return { linked: true as const, waves: [], usualCoInvestors, quota: null as PipelineQuota | null };

  // Stage 2, wave A — everything that only needs orgIds / investorCatalogEntityId
  // / email, with no dependency on each other. roundValuationBasisAvailable()
  // and interactionLogAvailable() are capability PROBES (capability-probe.ts)
  // that cache their result per warm server instance — free on every call
  // after the first on that instance, so they're resolved inline rather than
  // inside the Promise.all (no real round trip to wait on, on a hot path).
  // Prompt 115 Block E — two literal select strings, not one built from a
  // runtime-conditional variable: supabase-js parses the select string AT
  // THE TYPE LEVEL to infer each row's shape, so a variable in its place
  // (even one only ever holding one of these two literals) resolves to a
  // ParserError type instead — confirmed the hard way rewriting this stage.
  const basisAvailable = await roundValuationBasisAvailable();
  const interactionLogOn = await interactionLogAvailable();

  const [
    archiveResult, levelRowsResult, evaluationTraceOrgIds, tasksFollowupsPair, orgsResult, startupProfilesResult,
    activeWatchResult, activeFollowOnPairs, activatedPitchResult, closedIds, admissionRowsResult,
    interactionLogResult, teamRowsResult,
  ] = await timeBlock('stage2.waveA', () => Promise.all([
    admin.from('investor_archive_entries').select('org_id, archived_at').is('reopened_at', null).eq('investor_email', email),
    investorCatalogEntityId
      ? admin.from('investor_interest_levels').select('org_id, level, status').eq('investor_catalog_entity_id', investorCatalogEntityId).in('org_id', orgIds)
      : Promise.resolve({ data: [] as LevelRow[] }),
    computeEvaluationTraceOrgIds(admin, orgIds, investorCatalogEntityId, email),
    Promise.all([
      admin.from('investor_tasks').select('org_id, title, due_at, reminder_at, snoozed_until').eq('investor_email', email).eq('done', false).in('org_id', orgIds),
      admin.from('investor_followups').select('org_id, note, remind_at').eq('investor_email', email).eq('done', false).in('org_id', orgIds),
    ]),
    // Prompt 715 Pedido F — round_raising, moderation_status and
    // moderation_suspended_until are read here (not fetched specially
    // later) so the card-marking pass at the end of this function has them
    // in hand for every card, relationship or discovery, with no new
    // per-card query.
    basisAvailable
      ? admin.from('orgs').select('id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country, round_valuation_eur, round_valuation_basis, intro_problem, intro_solution, round_target_close_date, website, round_raising, moderation_status, moderation_suspended_until').in('id', orgIds)
      : admin.from('orgs').select('id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country, round_valuation_eur, intro_problem, intro_solution, round_target_close_date, website, round_raising, moderation_status, moderation_suspended_until').in('id', orgIds),
    admin.from('matchdeal_profiles').select('id, membership_id, description').eq('kind', 'startup').in('membership_id', orgIds),
    investorCatalogEntityId
      ? admin.from('investor_watches').select('org_id').eq('investor_catalog_entity_id', investorCatalogEntityId).eq('status', 'active').in('org_id', orgIds)
      : Promise.resolve({ data: [] as { org_id: string }[] }),
    getActiveFollowOnPairs(admin, orgIds),
    orgIds.length ? admin.from('org_mini_pitches').select('org_id').in('org_id', orgIds).not('activated_at', 'is', null) : Promise.resolve({ data: [] as { org_id: string }[] }),
    closedOrgIds(admin, orgIds),
    // Prompt 687 §4 — hoisted here (was fetched much later, sequentially,
    // right before the admission upsert): this SELECT has no dependency on
    // discoveryCards, only on investorCatalogEntityId. The upsert itself
    // still happens after cards/discoveryCards are computed below — this
    // only moves the READ earlier.
    // Prompt 715 Pedido G — reserved_at/presented_at added here (same
    // query, no new round trip): the reservation/consume/quota logic below
    // needs all three timestamps.
    investorCatalogEntityId
      ? admin.from('investor_pipeline_admissions').select('org_id, admitted_at, reserved_at, presented_at').eq('investor_catalog_entity_id', investorCatalogEntityId)
      : Promise.resolve({ data: [] as { org_id: string; admitted_at: string; reserved_at: string | null; presented_at: string | null }[] }),
    // Prompt 419 §B.3 — hoisted the same way: depends on orgIds/
    // investorCatalogEntityId only, not on `cards`.
    interactionLogOn && investorCatalogEntityId
      ? admin.from('investor_interaction_log').select('startup_org_id').eq('investor_catalog_entity_id', investorCatalogEntityId).in('startup_org_id', orgIds)
      : Promise.resolve({ data: [] as { startup_org_id: string }[] }),
    // Prompt 345 §B — the investor team's user ids, needed later to resolve
    // team emails for the withdraw-window check. No dependency on `cards`
    // either; only the per-card resolveWithdrawWindowSignals call below
    // does.
    investorCatalogEntityId
      ? admin.from('matchdeal_investor_members').select('user_id').eq('catalog_entity_id', investorCatalogEntityId).eq('status', 'active')
      : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]));

  const { data: archiveEntries } = archiveResult;
  const archivedOrgIds = new Set((archiveEntries ?? []).map((e) => e.org_id as string));
  const archivedAtByOrg = new Map((archiveEntries ?? []).map((e) => [e.org_id as string, e.archived_at as string]));

  const levelRowsByOrg = new Map<string, { level: 2 | 3; status: 'granted' | 'pending' | 'denied' }[]>();
  for (const r of levelRowsResult.data ?? []) {
    const list = levelRowsByOrg.get(r.org_id) ?? [];
    list.push({ level: r.level, status: r.status });
    levelRowsByOrg.set(r.org_id, list);
  }

  const [{ data: pendingTasks }, { data: pendingFollowups }] = tasksFollowupsPair;
  const now = new Date();
  interface NextActionCandidate { label: string; at: string | null }
  const nextActionCandidatesByOrg = new Map<string, NextActionCandidate[]>();
  const pushCandidate = (orgId: string | null, c: NextActionCandidate) => {
    if (!orgId) return;
    const list = nextActionCandidatesByOrg.get(orgId) ?? [];
    list.push(c);
    nextActionCandidatesByOrg.set(orgId, list);
  };
  for (const t of pendingTasks ?? []) {
    if (t.snoozed_until && new Date(t.snoozed_until as string) > now) continue;
    const at = (t.due_at ?? t.reminder_at) as string | null;
    pushCandidate(t.org_id as string | null, { label: t.title as string, at });
  }
  for (const f of pendingFollowups ?? []) {
    const at = f.remind_at as string;
    const label = `Revisit ${new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
    pushCandidate(f.org_id as string, { label, at });
  }
  for (const list of nextActionCandidatesByOrg.values()) {
    list.sort((a, b) => (a.at ?? '9999').localeCompare(b.at ?? '9999'));
  }
  // Prompt 715 Pedido E — a card with a pending "revisit on…" follow-up
  // unblocks the next wave, same as a watch or a pending level-3 request.
  const followupPendingOrgIds = new Set((pendingFollowups ?? []).map((f) => f.org_id as string));

  // Item 3.1 — a membership_id an eligible source resolved that doesn't
  // exist in orgs used to fall through this .in() silently: the card just
  // never rendered, with no error, no log, nothing to grep for. That's
  // exactly how five seed-data matchdeal_profiles rows (e1000000-… orgs,
  // never created) stayed invisible for as long as they did. This can't
  // recover the row — the fix is publishing real startups — but it can
  // stop hiding the inconsistency.
  const orgs = orgsResult.data;
  const resolvedOrgIds = new Set((orgs ?? []).map((o) => o.id as string));
  const missingOrgIds = orgIds.filter((id) => !resolvedOrgIds.has(id));
  if (missingOrgIds.length > 0) {
    console.error('getPipelineWaves: eligible org id(s) resolved to no row in orgs — data inconsistency, not expected:', missingOrgIds);
  }
  // Prompt 715 Pedido F — the raw org row per id, for the late card-marking
  // pass at the end of this function (round_raising, moderation state).
  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o as Record<string, unknown>]));

  const startupProfiles = startupProfilesResult.data;
  const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));
  // P134-A — the fuller MatchDeal description, shown only in a row's
  // expanded state (the collapsed row keeps the existing one_liner). Read
  // off the same matchdeal_profiles fetch above, no second query.
  const descriptionByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.description as string | null]));
  const startupProfileIds = [...profileByOrg.values()];

  const watchingOrgIds = new Set((activeWatchResult.data ?? []).map((r) => r.org_id as string));

  const thesis: InvestorThesis = {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
    exclusionsSectors: investorProfile.exclusions_sectors, exclusionsNotes: investorProfile.exclusions_notes,
  };

  const followOnSignalsByOrg = new Map<string, FollowOnPayload[]>();
  for (const pair of activeFollowOnPairs) {
    const list = followOnSignalsByOrg.get(pair.orgId) ?? [];
    list.push(shapeFollowOnPayload(true, pair.visibility, pair.investorName));
    followOnSignalsByOrg.set(pair.orgId, list);
  }
  const orgIdsWithMiniPitch = new Set((activatedPitchResult.data ?? []).map((r) => r.org_id as string));

  // Stage 2, wave B — the two reads that genuinely need profileByOrg/
  // startupProfileIds from wave A: swipes (per startup MatchDeal profile)
  // and the Hype gate (per startup MatchDeal profile, gated on the plan
  // tier already resolved in stage 1).
  const [swipesResult, hypeResult] = await timeBlock('stage2.waveB', () => Promise.all([
    startupProfileIds.length
      ? admin.from('matchdeal_swipes').select('target_profile_id, direction, pass_reason').eq('actor_profile_id', investorProfile.id).in('target_profile_id', startupProfileIds)
      : Promise.resolve({ data: [] as { target_profile_id: string; direction: string; pass_reason: string | null }[] }),
    viewerPlanTier === HYPE_GATE_PLAN_TIER && startupProfileIds.length > 0
      ? admin.from('matchdeal_startup_hype').select('startup_profile_id, is_hype').in('startup_profile_id', startupProfileIds)
      : Promise.resolve({ data: [] as { startup_profile_id: string; is_hype: boolean }[] }),
  ]));
  const swipeByStartupProfile = new Map((swipesResult.data ?? []).map((s) => [s.target_profile_id as string, s]));
  const hypeProfileIds = new Set((hypeResult.data ?? []).filter((r) => r.is_hype).map((r) => r.startup_profile_id as string));
  const orgIdByProfileId = new Map([...profileByOrg.entries()].map(([orgId, profileId]) => [profileId, orgId]));
  const hypeOrgIds = new Set([...hypeProfileIds].map((pid) => orgIdByProfileId.get(pid)).filter((v): v is string => !!v));

  const cards = timeBlock('cardAssembly', async () => (orgs ?? []).map((org) => {
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

    // Prompt 681 §1 — the one taxonomy, derived from facts this function
    // already has in hand (status folds in the legacy matchdeal_swipes
    // fallback the same way the rest of this card object does, so the
    // taxonomy never disagrees with the status pill it's replacing).
    const orgLevelRows = levelRowsByOrg.get(org.id as string) ?? [];
    const hasGrantedLevel3 = orgLevelRows.some((r) => r.level === 3 && r.status === 'granted');
    const hasGrantedLevel2 = orgLevelRows.some((r) => r.level === 2 && r.status === 'granted') || orgLevelRows.some((r) => r.level === 3);
    const hasActiveDataRoomGrant = grantedOrgIds.has(org.id as string);
    const isArchivedNow = archivedOrgIds.has(org.id as string);
    const pipelineStage: InvestorPipelineStage = investorPipelineStage({
      latestDecision: status === 'passed' ? 'passed' : status === 'interested' ? 'interested' : null,
      isArchived: isArchivedNow,
      hasGrantedLevel3,
      hasActiveDataRoomGrant,
      hasEvaluationTrace: evaluationTraceOrgIds.has(org.id as string),
    });
    const pipelineStageDetail = investorPipelineStageDetail(pipelineStage, { hasGrantedLevel2, hasGrantedLevel3 });

    // Prompt 681 §2.4 point 6 — precedence: a real pending task/reminder
    // beats a pending level-3 request beats an unactioned data-room grant.
    // "Reply to the founder" (an unanswered message) is deliberately not
    // included — nothing loaded here says who sent the LAST message in a
    // thread, only that a thread exists, and the prompt is explicit that
    // this must reuse data already on the card, never a new query.
    const hasPendingLevel3Request = orgLevelRows.some((r) => r.level === 3 && r.status === 'pending');
    const nextActionCandidate = (nextActionCandidatesByOrg.get(org.id as string) ?? [])[0] ?? null;
    const nextAction = nextActionCandidate
      ? { label: nextActionCandidate.label, at: nextActionCandidate.at, overdue: !!nextActionCandidate.at && new Date(nextActionCandidate.at) < now }
      : hasPendingLevel3Request
        ? { label: 'Waiting for the founder', at: null, overdue: false }
        : hasActiveDataRoomGrant
          ? { label: 'Access granted — open the data room', at: null, overdue: false }
          : null;

    return {
      orgId: org.id, name: org.name, oneLiner: org.one_liner, website: org.website ?? null,
      hype: hypeOrgIds.has(org.id as string),
      isWatching: watchingOrgIds.has(org.id as string),
      // Prompt 715 Pedido E.
      hasPendingFollowup: followupPendingOrgIds.has(org.id as string),
      // Prompt 715 Pedido F — set below, after this array exists (needs the
      // reservation/eligibility state every card already has in hand by
      // then). null means nothing to flag; the rest of the card is
      // unaffected either way.
      markedNote: null as string | null,
      // Prompt 716 Pedido C — set below, only on a 'passed' relationship
      // card whose reevaluation condition was just fulfilled and is due
      // to be shown this call.
      isReevaluation: false,
      reevaluationMessage: null as string | null,
      roundTargetCloseDate: (org as { round_target_close_date?: string | null }).round_target_close_date ?? null,
      description: descriptionByOrg.get(org.id as string) ?? null,
      // Prompt 325 — Discovery-visible reason to click "Interested",
      // additional to oneLiner. Same absent-key discipline as the rest of
      // this card object's optional fields.
      ...projectIntroPitch({ introProblem: org.intro_problem as string | null, introSolution: org.intro_solution as string | null }),
      hasMiniPitch: orgIdsWithMiniPitch.has(org.id as string),
      sectors: org.sectors ?? [], stage: org.stage,
      hqCity: org.hq_city, country: org.country, roundTargetEur: org.round_target_eur,
      roundMinTicketEur: org.round_min_ticket_eur, roundValuationEur: org.round_valuation_eur,
      roundValuationBasis: (org as { round_valuation_basis?: 'pre_money' | 'post_money' }).round_valuation_basis ?? null,
      roundInstruments: org.round_instruments ?? [], matchScore: score, matchReasons: reasons,
      status, passReason: decision ? decision.reason_detail : (swipe?.pass_reason ?? null),
      pipelineStage, pipelineStageDetail, nextAction,
      hasGrantedLevel2, hasGrantedLevel3, hasPendingLevel3Request,
      archivedAt: archivedAtByOrg.get(org.id as string) ?? null,
      // Prompt 681 §2.4 point 7 — the most recent of every event already
      // loaded for this card: the decision, the archive, and a message
      // (lastMessageAt is set further below once threads are read, so this
      // is refined there too). Never a new event source — anything not
      // already on this object (a document open, a reminder's own
      // created_at) is left out rather than fetched specially for this.
      lastActivityAt: [decision?.decided_at, archivedAtByOrg.get(org.id as string)]
        .filter((v): v is string => !!v)
        .sort()
        .pop() ?? null,
      // Item 6 — "não se sabe quando e se foi submetido". decided_at/
      // decided_by already existed on investor_relationship_decisions; only
      // matchdeal_swipes-only signals (pre-dating that table) have neither,
      // so both stay null rather than fabricating a date. decidedByMe is a
      // plain equality check (no extra query needed to resolve an identity)
      // — "by you" vs "by a colleague at your firm" is all AP-14 promises,
      // never a name/email the other side of the org didn't already share.
      decidedAt: decision?.decided_at ?? null,
      decidedByMe: decision ? decision.decided_by === userId : null,
      trackingCount: org.stage ? (trackingCountByStage.get(org.stage as string)?.size ?? 0) : 0,
      hasDataRoomAccess: grantedOrgIds.has(org.id as string),
      // P132-A — which half of the union this card came through (a card can
      // be both). Client-facing so the UI can badge it "Invited" instead of
      // a wave number — deciding that is presentation, not eligibility.
      viaGrant: grantedOrgIds.has(org.id as string),
      viaDecision: decidedOrgIds.has(org.id as string),
      // Prompt 318 — a My Network referral this investor accepted. Distinct
      // label from "Invited" on purpose (Pedido C's own stated preference):
      // this relationship came through a mutual contact, not the founder
      // reaching out directly.
      viaReferral: referredOrgIdsViaReferralSet.has(org.id as string),
      referredByName: referrerNameByOrgId.get(org.id as string) ?? null,
      // Prompt 683 — a real portfolio company: this investor's firm is
      // already `invested`, per the founder's own pipeline. Presentation
      // only (a badge) — pipelineStage is derived the same way for every
      // other card, never special-cased for this flag (§1's own rule 2).
      viaPortfolio: portfolioOrgIdsSet.has(org.id as string),
      followOnSignals: followOnSignalsByOrg.get(org.id as string) ?? [],
      isArchived: archivedOrgIds.has(org.id as string),
      // Prompt 345 §B/§C — set below, after this array exists (needs its
      // own async resolution per interested card). Placeholders here so
      // both fields are always present on the type; never read before that.
      canWithdrawInterest: false,
      hasConversation: false,
      // Prompt 681 §2.4 — the row's "Last activity" column; set alongside
      // hasConversation below from the same deal_threads read (no new query).
      lastMessageAt: null as string | null,
      // Prompt 419 §B.3 — set below, same reason. false predates
      // investor_interaction_log entirely (never invented).
      hasManualInteractionLog: false,
    };
  }).sort((a, b) => b.matchScore - a.matchScore));
  const resolvedCards = await cards;

  // Prompt 345 §C — the interested-card status line's "In conversation"
  // signal: deal_threads.last_message_at is non-null the moment either
  // side has sent a message, so this is a single batched read, no separate
  // deal_messages count needed. Genuinely needs `resolvedCards` (the
  // interested-org subset) to exist first — the one read in this whole
  // function that can't be hoisted into stage 2.
  const interestedOrgIds = resolvedCards.filter((c) => c.status === 'interested').map((c) => c.orgId as string);
  if (interestedOrgIds.length > 0 && investorCatalogEntityId) {
    const { data: threads } = await timeBlock('dealThreads', () => admin.from('deal_threads').select('startup_org_id, last_message_at')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).in('startup_org_id', interestedOrgIds));
    const lastMessageAtByOrg = new Map((threads ?? []).filter((t) => t.last_message_at).map((t) => [t.startup_org_id as string, t.last_message_at as string]));
    for (const c of resolvedCards) {
      const lastMessageAt = lastMessageAtByOrg.get(c.orgId as string);
      if (lastMessageAt) {
        c.hasConversation = true; c.lastMessageAt = lastMessageAt;
        if (!c.lastActivityAt || lastMessageAt > c.lastActivityAt) c.lastActivityAt = lastMessageAt;
      }
    }
  }

  // Prompt 419 §B.3 — the Evaluation Tools "uncontacted pipeline" discovery
  // view needs to know which cards this investor has NEVER touched at all.
  // Query itself hoisted into stage 2 (interactionLogResult); only the
  // per-card flag-setting needs `resolvedCards`.
  const loggedOrgIds = new Set((interactionLogResult.data ?? []).map((r) => r.startup_org_id as string));
  for (const c of resolvedCards) if (loggedOrgIds.has(c.orgId as string)) c.hasManualInteractionLog = true;

  // Prompt 345 §B — "Withdraw interest": whether the window is still open,
  // computed HERE (not lazily on expand) because P134-A's own acceptance
  // criterion is that expanding a card never fetches. Only for cards with a
  // REAL decision (decidedAt set — a legacy swipe-only 'like' predates
  // investor_relationship_decisions and was never tracked with a founder
  // task/notification to withdraw in the first place). Team emails resolved
  // once (teamRowsResult hoisted into stage 2), reused for every such card,
  // not once per card.
  const withdrawableCards = resolvedCards.filter((c) => c.status === 'interested' && c.decidedAt);
  if (withdrawableCards.length > 0 && investorCatalogEntityId) {
    const teamEmails = await timeBlock('withdraw.teamEmails', () => Promise.all((teamRowsResult.data ?? []).map(async (r) => {
      const { data } = await admin.auth.admin.getUserById(r.user_id as string);
      return data?.user?.email ?? null;
    })));
    const investorEmails = [...new Set([email, ...teamEmails.filter((e): e is string => !!e)])];
    await timeBlock('withdraw.signals', () => Promise.all(withdrawableCards.map(async (c) => {
      const signals = await resolveWithdrawWindowSignals(admin, {
        orgId: c.orgId as string, investorCatalogEntityId, decidedAt: c.decidedAt as string, investorEmails,
      });
      c.canWithdrawInterest = canWithdrawInterest(signals);
    })));
  }

  // P132-A — a relationship card (grant, decision, referral, or — Prompt
  // 683 — an existing portfolio investment) is never subject to the
  // discovery wave-gate: the relationship already exists, so there's
  // nothing left to "unlock" by treating other cards first. Only the
  // remaining discovery-only cards go through the original doseamento.
  // Prompt 153 — nor to the monthlyCap admission gate below, same reasoning:
  // a real grant/decision/investment is consent (or a fact) that already
  // happened, not a discovery-quota spend.
  const relationshipCards = resolvedCards.filter((c) => c.viaGrant || c.viaDecision || c.viaReferral || c.viaPortfolio);
  const discoveryCards = resolvedCards.filter((c) => !c.viaGrant && !c.viaDecision && !c.viaReferral && !c.viaPortfolio);

  // Prompt 715 Pedido G — replaces the old "admit everything the month's
  // budget affords, all at once" model. Reservation is now PROGRESSIVE (one
  // wave's worth at a time, only once the previous wave is fully treated —
  // computeReservationTargets, pipeline-admissions.ts) and ATOMIC (the
  // actual write happens inside reserve_pipeline_admissions(), an advisory-
  // locked SQL function — see this prompt's own migration). computeAdmissions
  // (Prompt 850 §D) is untouched; it's reused below only to produce the
  // quota DISPLAY line, now fed presented_at instead of admitted_at, because
  // the quota is what's been shown, not what's been set aside.
  let admittedDiscoveryCards = discoveryCards;
  let quota: PipelineQuota | null = null;
  const admissionRows = admissionRowsResult.data ?? [];
  const presentedBeforeOrgIds = new Set(admissionRows.filter((a) => a.presented_at).map((a) => a.org_id as string));
  if (investorCatalogEntityId) {
    // Prompt 402 — resolver centralized in portal-access.ts (same mapping,
    // same 'tier_a' fallback) so this and the startup dossier's Hype badge
    // gate can't drift into two different tier mappings. Reuses viewerPlanTier
    // (resolved once, in stage 1, for the 🔥 Hype marker) rather than a
    // second call.
    const monthlyCap = investorPlanRow(viewerPlanTier).monthlyCap;
    const reservedOrgIds = new Set(admissionRows.filter((a) => a.reserved_at).map((a) => a.org_id as string));

    const { alreadyReserved, candidateOrgIds: computedCandidateOrgIds } = computeReservationTargets(discoveryCards, reservedOrgIds);
    admittedDiscoveryCards = alreadyReserved;
    // Prompt 715 Pedido C — "a admissão do Pedido G não reserva enquanto a
    // pausa estiver activa". Only NEW reservations stop; anything already
    // reserved/presented keeps showing exactly as before.
    const context = await getInvestorContext(admin, investorCatalogEntityId);
    const candidateOrgIds = isPauseActive(context, new Date().toISOString()) ? [] : computedCandidateOrgIds;
    if (candidateOrgIds.length > 0) {
      const { data: reserveResult } = await timeBlock('admissions.reserve', () => admin.rpc('reserve_pipeline_admissions', {
        p_investor_catalog_entity_id: investorCatalogEntityId, p_org_ids: candidateOrgIds,
        p_monthly_cap: monthlyCap, p_month_start: calendarMonthStartIso(new Date().toISOString()),
      }));
      const newlyReservedIds = new Set(
        (reserveResult as { org_id: string; reserved: boolean }[] | null ?? []).filter((r) => r.reserved).map((r) => r.org_id),
      );
      admittedDiscoveryCards = [...alreadyReserved, ...discoveryCards.filter((c) => newlyReservedIds.has(c.orgId as string))];
    }

    // "N of M presented this month" — computeAdmissions' own arithmetic,
    // reused verbatim, fed PRESENTED timestamps rather than admitted ones.
    const presentedAtByOrg = new Map(admissionRows.filter((a) => a.presented_at).map((a) => [a.org_id as string, a.presented_at as string]));
    quota = computeAdmissions({
      discoveryCards: admittedDiscoveryCards, admittedAtByOrg: presentedAtByOrg,
      eligibleNowOrgIds: new Set(publishedOrgIds), monthlyCap, nowIso: new Date().toISOString(),
    }).quota;
  }

  // Prompt 850 §C — the relationship group is no longer numbered as a wave;
  // buildPipelineWaves tags each group with its kind and, for discovery,
  // its own 0-based discoveryIndex so the panel's labels start at "Wave 1".
  const waves = buildPipelineWaves(relationshipCards, admittedDiscoveryCards);

  // Prompt 715 Pedido G (consume) / Pedido H (position+visibility record).
  // The FIRST time a reserved discovery card is actually inside an UNLOCKED
  // wave, of ANY user at the firm, it is "presented" — this is what counts
  // against the monthly quota from here on, never reservation alone. Pedido
  // H asked for position/visibility to be "consultável por episódio";
  // rather than a new table, this reuses investor_signal_events (Pedido A)
  // with a 'sistema:wave_presented' event carrying wave_index/
  // position_in_wave in its snapshot — see this prompt's own DECISIONS.md
  // for why that's cheaper than a dedicated table, per the prompt's own
  // "escolham o mais barato" instruction. Skips entirely (zero extra
  // queries) on the common case of a repeat page load with nothing new to
  // present.
  if (investorCatalogEntityId) {
    const unlockedDiscoveryWaves = waves.filter((w) => w.kind === 'discovery' && w.unlocked);
    const presentedNowIds = unlockedDiscoveryWaves.flatMap((w) => w.items.map((c) => (c as { orgId: string }).orgId));
    const newlyPresentedIds = presentedNowIds.filter((id) => !presentedBeforeOrgIds.has(id));
    if (presentedNowIds.length > 0) {
      await timeBlock('admissions.present', () => admin.rpc('mark_pipeline_presented', {
        p_investor_catalog_entity_id: investorCatalogEntityId, p_org_ids: presentedNowIds,
      }));
    }
    if (newlyPresentedIds.length > 0) {
      const isTestOrInternal = await isFirmTestOrInternal(admin, investorCatalogEntityId);
      await timeBlock('admissions.presentedSignals', () => Promise.all(unlockedDiscoveryWaves.flatMap((w) => w.items.map(async (c, i) => {
        const orgId = (c as { orgId: string }).orgId;
        if (!newlyPresentedIds.includes(orgId)) return;
        try {
          const episodeId = await findOrOpenEpisode(admin, investorCatalogEntityId, orgId);
          await writeSignalEvent(admin, {
            episodeId, level: 'sistema', kind: 'wave_presented',
            snapshot: { wave_index: w.index, position_in_wave: i, visibility: 'presented', policy_version: 1 },
            isTestOrInternal,
          });
        } catch (e) { console.error('wave_presented signal event failed:', e); }
      }))));
    }
  }

  // Prompt 715 Pedido F — a card that stops being cleanly "still on offer"
  // stays IN PLACE, marked and explained, instead of silently vanishing or
  // (for three of the four cases below) instead of losing the rest of its
  // own data. Computed here, at the LAST point before projection, over
  // every card actually about to be shown (relationship + this request's
  // admitted discovery set) — never over the full candidate pool, so a
  // card that was never shown can't gain a note it was never entitled to.
  const shownCards = [...relationshipCards, ...admittedDiscoveryCards];
  let revokedOrgIds = new Set<string>();
  if (shownCards.length > 0) {
    const shownOrgIds = shownCards.map((c) => c.orgId as string);
    // Case (a): the founder revoked a grant that once existed. hasDataRoomAccess
    // already reflects "is a grant active RIGHT NOW"; this only asks "did one
    // ever exist and get revoked" for the cards where the answer is no.
    const { data: revokedGrants } = await timeBlock('grants.revoked', () => admin.from('access_grants')
      .select('org_id, revoked_at').in('org_id', shownOrgIds).not('revoked_at', 'is', null)
      .or(`grantee_email.eq.${email},invited_email.eq.${email}`));
    revokedOrgIds = new Set((revokedGrants ?? []).map((g) => g.org_id as string));
    const revokedAtByOrg = new Map((revokedGrants ?? []).map((g) => [g.org_id as string, g.revoked_at as string]));

    for (const c of shownCards) {
      const orgId = c.orgId as string;
      const org = orgById.get(orgId) as { round_raising?: boolean | null } | undefined;
      if (revokedOrgIds.has(orgId) && !c.hasDataRoomAccess) {
        c.markedNote = `The founder revoked data room access on ${fmtDateOnly(revokedAtByOrg.get(orgId))}.`;
      } else if (c.matchReasons.includes('excluded')) {
        // Case (c) — a relationship (or, rarely, a small-pool discovery)
        // card that no longer fits a mandate exclusion added since it was
        // let in. matchReasons already reflects the CURRENT thesis — no
        // second computeMatchScore call needed.
        c.markedNote = 'No longer fits your mandate — you added an exclusion that now covers this startup.';
      } else if (org && org.round_raising === false) {
        // Case (d) — "sem presumir que a empresa desapareceu; continua abrível".
        c.markedNote = 'This round has closed.';
      }
    }
  }

  // Prompt 715 Pedido F, case (b) — a relationship card (grant/decision/
  // referral/portfolio, which bypasses eligiblePipelineOrgIds entirely) can
  // point at a startup account that's since been hidden or suspended — the
  // exact hole Prompt 556 §C already closed for CLOSED orgs, generalized
  // here to the other two moderation states. A discovery card can't reach
  // this: eligiblePipelineOrgIds already excludes anything not currently
  // visible.
  const orgModerationById = new Map(shownCards.map((c) => {
    const org = orgById.get(c.orgId as string) as { moderation_status?: string | null; moderation_suspended_until?: string | null } | undefined;
    return [c.orgId as string, org];
  }));
  const nowIsoForModeration = new Date().toISOString();
  const suspendedOrHiddenOrgIds = new Set(
    relationshipCards
      .map((c) => c.orgId as string)
      .filter((orgId) => !closedIds.has(orgId))
      .filter((orgId) => {
        const org = orgModerationById.get(orgId);
        if (!org) return false;
        return !isVisibleToOthers((org.moderation_status ?? 'active') as ModerationStatus, org.moderation_suspended_until ?? null, nowIsoForModeration);
      }),
  );

  // Prompt 556 §C — a closed org (orgs.closed_at, migration 0305) is
  // projected down to name + status here, at the LAST possible point, after
  // every enrichment step above has run. Doing it earlier would mean each
  // new enrichment has to remember to skip closed cards; doing it here means
  // none of them can leak, because nothing they wrote survives the
  // projection. A closed org can only still be in this list through HISTORY
  // (a recorded decision, an accepted referral) — discovery and grants both
  // exclude it upstream now. (closedIds itself was fetched in stage 2 —
  // Prompt 556 §C's ordering guarantee is about PROJECTION happening last,
  // not about the READ happening last; nothing between stage 2 and here
  // can put a closed org back into play.) Prompt 715 §Pedido F extends the
  // SAME projection to a suspended/hidden relationship card.
  const unavailableOrgIds = new Set([...closedIds, ...suspendedOrHiddenOrgIds]);

  // Prompt 716 Pedido C — reevaluation reapresentation. Complete no-op
  // until Prompt 715's schema is live (reevaluationAlertsAvailable), per
  // this prompt's own explicit feature-flag instruction. Attaches to the
  // EXISTING 'passed' relationship card rather than a new wave kind — see
  // reevaluation-presentation.ts's own header for why that already gets
  // "fora da quota" and "never wave-gated" for free, and what that
  // deliberately trades away (no independent "next wave to unlock" timing
  // for a card that was never wave-gated to begin with).
  if (investorCatalogEntityId && await reevaluationAlertsAvailable()) {
    await fulfillDateConditions(admin, investorCatalogEntityId);
    const candidates = await fetchReevaluationCandidates(admin, investorCatalogEntityId);
    const toPresent = selectReevaluationsToPresent(candidates);
    for (const candidate of toPresent) {
      const card = relationshipCards.find((c) => c.orgId === candidate.orgId);
      if (!card || unavailableOrgIds.has(candidate.orgId)) continue;
      if (isOutOfCurrentMandate(card.matchReasons)) {
        // Pedido B — fulfilled, but out of mandate now: recorded, never reapresented.
        card.markedNote = 'Reevaluation condition met, but this startup no longer fits your current mandate.';
      } else {
        card.isReevaluation = true;
        card.reevaluationMessage = reapresentationMessage(
          conditionKindLabel(candidate.conditionKind as ConditionKind), candidate.fulfilledFactText, candidate.fulfilledAt,
        );
      }
      try {
        const episodeId = await findOrOpenEpisode(admin, investorCatalogEntityId, candidate.orgId);
        await markReevaluationRepresented(admin, candidate.id, episodeId);
        const isTestOrInternal = await isFirmTestOrInternal(admin, investorCatalogEntityId);
        await writeSignalEvent(admin, { episodeId, level: 'sistema', kind: 'represented', isTestOrInternal });
      } catch (e) { console.error('reevaluation representation bookkeeping failed:', e); }
    }
  }

  const projectedWaves = unavailableOrgIds.size === 0 ? waves : waves.map((w) => ({
    ...w,
    items: w.items.map((c) => (unavailableOrgIds.has(c.orgId as string)
      ? projectUnavailableCard(c, closedIds.has(c.orgId as string) ? 'closed' : 'unavailable')
      : c)),
  }));

  console.log(`[pipeline-timing] TOTAL: ${Date.now() - pipelineStart}ms`);
  return { linked: true as const, waves: projectedWaves, usualCoInvestors, quota };
}

function fmtDateOnly(iso: string | undefined): string {
  if (!iso) return 'an earlier date';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
