// Investor Workspace Pipeline (prompt 58) — extracted out of the route
// (prompt 62.4) so the CSV export can reuse the exact same waves/scores
// computation instead of re-deriving it; a second source of truth for
// "what's in my Pipeline" would drift.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';
import { closedOrgIds } from './org-closed';
import { projectUnavailableCard } from './closed-org-card';
import { activeGrantOrgIds, eligiblePipelineOrgIds, resolveInvestorCatalogEntityId, resolveInvestorPlanTierForProfile, resolveInvestorProfile, resolveViewerIsTest } from './portal-access';
import { pipelineTestFlagAvailable } from './pipeline-test-flag-capability';
import { roundValuationBasisAvailable } from './round-valuation-basis-capability';
import { investorPlanRow } from './plans';
import { resolveActorDisplays } from './network-db';
import { getActiveFollowOnPairs } from './network-followon-db';
import { shapeFollowOnPayload, type FollowOnPayload } from './network';
import { projectIntroPitch } from './investor-interest-level';
import { canWithdrawInterest, resolveWithdrawWindowSignals } from './investor-interest-withdrawal';
import { interactionLogAvailable } from './investor-interaction-log-capability';

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
//
// Item #15 — this aggregates ACROSS every investor and startup on the
// platform, which is exactly where internal/QA activity is most invisible
// to spot and most damaging to trust ("6 other investors are tracking
// this" counting the team's own dogfood swipes). Two independent filters,
// both no-ops until migration 0139 lands: startups whose org is_test never
// contribute a target stage, and investor actors whose catalog_entity
// is_test never contribute a like.
async function computeTrackingCountsByStage(admin: SupabaseClient, excludeInvestorProfileId: string) {
  const since = new Date(Date.now() - TRACKING_WINDOW_DAYS * 86400000).toISOString();
  const testFlagAvailable = await pipelineTestFlagAvailable();

  const { data: allStartupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id').eq('kind', 'startup');
  const { data: allOrgs } = testFlagAvailable
    ? await admin.from('orgs').select('id, stage, is_test')
    : await admin.from('orgs').select('id, stage');
  const stageByOrgId = new Map((allOrgs ?? []).map((o) => [o.id as string, o.stage as string | null]));
  const testOrgIds = new Set((allOrgs ?? []).filter((o) => (o as { is_test?: boolean }).is_test).map((o) => o.id as string));
  const stageByProfileId = new Map(
    (allStartupProfiles ?? [])
      .filter((p) => !testOrgIds.has(p.membership_id as string))
      .map((p) => [p.id as string, stageByOrgId.get(p.membership_id as string) ?? null]),
  );

  const { data: recentLikes } = await admin.from('matchdeal_swipes').select('actor_profile_id, target_profile_id')
    .eq('direction', 'like').gte('created_at', since).neq('actor_profile_id', excludeInvestorProfileId);

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
  const { data: actorRow } = await admin.from('network_actors').select('id').eq('matchdeal_profile_id', investorMatchdealProfileId).maybeSingle();
  const investorActorId = actorRow?.id as string | undefined;
  if (!investorActorId) return { orgIds: [] as string[], referrerNameByOrgId: new Map<string, string>() };

  const { data: accepted } = await admin.from('network_referrals')
    .select('referred_org_id, referrer_actor_id').eq('target_actor_id', investorActorId).eq('state', 'accepted');
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

// P132-A — the ID-only half of the union, for callers (the POST action
// route) that just need a membership check, not the full card data
// getPipelineWaves builds. See that function's own header comment for the
// full "why a union" reasoning; kept in sync with it deliberately (both
// read the same three sources), not re-derived independently.
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
  return [...new Set([...published, ...granted, ...(decisions ?? []).map((d) => d.org_id as string), ...referredOrgIds])];
}

// Prompt 345 §A.3 — pure, unit-tested on its own: whether a still-`open`
// card should nonetheless count as "treated" for wave-dosage purposes.
// Archiving no longer writes a pass swipe (see /api/portal/archive), so a
// card can be simultaneously isArchived AND status 'open' — without this,
// that card would sit forever as untreated and block every wave behind it.
// Tidying up IS treating it (Nuno's own call, documented in the prompt).
export function isTreatedForWaveDosage(card: { status: string; isArchived?: boolean }): boolean {
  return card.status !== 'open' || !!card.isArchived;
}

export async function getPipelineWaves(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string) {
  const investorProfile = await resolveInvestorProfile(admin, userId);
  if (!investorProfile) return { linked: false as const };

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();

  // P132-A — Pipeline eligibility is a UNION of two populations, per Nuno's
  // own product definition ("all the companies the app understands could
  // fit the mandate, before and after being contacted"):
  //   A. A real relationship with THIS investor — an active data-room
  //      grant (the founder's own consent to invite them in) or an
  //      already-recorded decision (interested/passed — history, never
  //      disappears even if the startup's MatchDeal profile later gets
  //      unpublished).
  //   B. Discovery — published MatchDeal profiles matching the mandate
  //      (P120-A, unchanged).
  // Before this fix, (A) didn't count at all: a startup that invited an
  // investor into its own data room — the strongest consent signal this
  // app has — could still be entirely absent from that investor's own
  // Pipeline the moment its MatchDeal profile wasn't published. That's the
  // exact contradiction Nuno hit (Access granted showed ablute_, Pipeline
  // didn't). What stays deliberately excluded: startups with NEITHER a
  // grant/decision NOR a published profile — showing those would be
  // visibility by side effect, the exact thing P107/addenda-P120-§3
  // already ruled out.
  const grantedOrgIdList = await activeGrantOrgIds(admin, email, person?.id ?? null);
  const grantedOrgIds = new Set(grantedOrgIdList);
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  const { data: decisions } = investorCatalogEntityId
    ? await admin.from('investor_relationship_decisions').select('org_id, decision, reason_detail, decided_at, decided_by')
      .eq('investor_catalog_entity_id', investorCatalogEntityId)
    : { data: [] as { org_id: string; decision: string; reason_detail: string | null; decided_at: string; decided_by: string }[] };
  const decisionByOrg = new Map((decisions ?? []).map((d) => [d.org_id as string, d]));
  const decidedOrgIds = new Set(decisionByOrg.keys());

  const viewerIsTest = await resolveViewerIsTest(admin, investorCatalogEntityId);
  const publishedOrgIds = await eligiblePipelineOrgIds(admin, viewerIsTest);
  const { orgIds: referredOrgIdsViaReferral, referrerNameByOrgId } = await acceptedReferralsForInvestor(admin, investorProfile.id as string);
  const referredOrgIdsViaReferralSet = new Set(referredOrgIdsViaReferral);
  const orgIds = [...new Set([...publishedOrgIds, ...grantedOrgIdList, ...decidedOrgIds, ...referredOrgIdsViaReferral])];
  const usualCoInvestors = (investorProfile as { usual_co_investors: string | null }).usual_co_investors;
  if (orgIds.length === 0) return { linked: true as const, waves: [], usualCoInvestors };

  // Item 8 — archiving used to leave a card looking completely unchanged on
  // the Pipeline (the entry itself landed fine in investor_archive_entries,
  // just nothing on THIS screen said so). Same source of truth the Archive
  // tab itself reads (createArchiveEntry/investor_archive_entries,
  // reopened_at is null = currently archived) — a real, reload-proof flag,
  // not session-local state.
  const { data: archiveEntries } = await admin.from('investor_archive_entries')
    .select('org_id').eq('investor_email', email).is('reopened_at', null);
  const archivedOrgIds = new Set((archiveEntries ?? []).map((e) => e.org_id as string));

  // Prompt 115 Block E — round_valuation_basis only added to the select once
  // the propose-only migration (0111) has landed; an unrecognized column
  // name in an explicit select list fails the whole query. Two literal
  // select strings (not one built from a runtime-conditional string) so
  // supabase-js's column-name type inference still works in both branches.
  const basisAvailable = await roundValuationBasisAvailable();
  const { data: orgs } = basisAvailable
    ? await admin.from('orgs').select(
        'id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country, round_valuation_eur, round_valuation_basis, intro_problem, intro_solution',
      ).in('id', orgIds)
    : await admin.from('orgs').select(
        'id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country, round_valuation_eur, intro_problem, intro_solution',
      ).in('id', orgIds);

  // Item 3.1 — a membership_id an eligible source resolved that doesn't
  // exist in orgs used to fall through this .in() silently: the card just
  // never rendered, with no error, no log, nothing to grep for. That's
  // exactly how five seed-data matchdeal_profiles rows (e1000000-… orgs,
  // never created) stayed invisible for as long as they did. This can't
  // recover the row — the fix is publishing real startups — but it can
  // stop hiding the inconsistency.
  const resolvedOrgIds = new Set((orgs ?? []).map((o) => o.id as string));
  const missingOrgIds = orgIds.filter((id) => !resolvedOrgIds.has(id));
  if (missingOrgIds.length > 0) {
    console.error('getPipelineWaves: eligible org id(s) resolved to no row in orgs — data inconsistency, not expected:', missingOrgIds);
  }

  const { data: startupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id, description')
    .eq('kind', 'startup').in('membership_id', orgIds);
  const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));
  // P134-A — the fuller MatchDeal description, shown only in a row's
  // expanded state (the collapsed row keeps the existing one_liner). Read
  // off the same matchdeal_profiles fetch above, no second query.
  const descriptionByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.description as string | null]));

  const thesis: InvestorThesis = {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
    exclusionsSectors: investorProfile.exclusions_sectors, exclusionsNotes: investorProfile.exclusions_notes,
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
  // fallback for signals recorded before this table existed. (decisionByOrg
  // itself was already fetched above, as part of computing the union.)

  // "Other investors tracking this" (prompt 62.3) — aggregated by stage
  // ACROSS THE WHOLE PLATFORM, never per-startup, and never resolved back to
  // an identity: the privacy limit from Prompt 61's scoping is non-negotiable
  // ("nunca expor o deal flow individual de outro investidor"). Two queries
  // regardless of how many cards there are — not one per card.
  const trackingCountByStage = await computeTrackingCountsByStage(admin, investorProfile.id);

  // Prompt 319 Pedido C.1 — follow-on signals ("an existing investor would
  // invest again"), masked here (never client-side) per shapeFollowOnPayload
  // before they ever leave this function — the same discipline
  // round_progress_visible_to_investors already uses in /api/portal/access.
  const activeFollowOnPairs = await getActiveFollowOnPairs(admin, orgIds);
  const followOnSignalsByOrg = new Map<string, FollowOnPayload[]>();
  for (const pair of activeFollowOnPairs) {
    const list = followOnSignalsByOrg.get(pair.orgId) ?? [];
    list.push(shapeFollowOnPayload(true, pair.visibility, pair.investorName));
    followOnSignalsByOrg.set(pair.orgId, list);
  }

  // Prompt 339 §B — existence only, never content, never level-gated: the
  // compact card is the Level-0-visible tier both callers already use, so
  // this is the one place a "pitch available" teaser can be computed
  // without waiting on/duplicating the level>=1 gate fetchDossierRawData
  // applies to the pitch's actual slides.
  const { data: activatedPitchRows } = orgIds.length
    ? await admin.from('org_mini_pitches').select('org_id').in('org_id', orgIds).not('activated_at', 'is', null)
    : { data: [] as { org_id: string }[] };
  const orgIdsWithMiniPitch = new Set((activatedPitchRows ?? []).map((r) => r.org_id as string));

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
      orgId: org.id, name: org.name, oneLiner: org.one_liner,
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
      followOnSignals: followOnSignalsByOrg.get(org.id as string) ?? [],
      isArchived: archivedOrgIds.has(org.id as string),
      // Prompt 345 §B/§C — set below, after this array exists (needs its
      // own async resolution per interested card). Placeholders here so
      // both fields are always present on the type; never read before that.
      canWithdrawInterest: false,
      hasConversation: false,
      // Prompt 419 §B.3 — set below, same reason. false predates
      // investor_interaction_log entirely (never invented).
      hasManualInteractionLog: false,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);

  // Prompt 345 §C — the interested-card status line's "In conversation"
  // signal: deal_threads.last_message_at is non-null the moment either
  // side has sent a message, so this is a single batched read, no separate
  // deal_messages count needed.
  const interestedOrgIds = cards.filter((c) => c.status === 'interested').map((c) => c.orgId as string);
  if (interestedOrgIds.length > 0 && investorCatalogEntityId) {
    const { data: threads } = await admin.from('deal_threads').select('startup_org_id, last_message_at')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).in('startup_org_id', interestedOrgIds);
    const conversingOrgIds = new Set((threads ?? []).filter((t) => t.last_message_at).map((t) => t.startup_org_id as string));
    for (const c of cards) if (conversingOrgIds.has(c.orgId as string)) c.hasConversation = true;
  }

  // Prompt 419 §B.3 — the Evaluation Tools "uncontacted pipeline" discovery
  // view needs to know which cards this investor has NEVER touched at all.
  // The other three getInteractionTimeline sources (investor-interaction-
  // log.ts) are already reflected above (status/isArchived/hasConversation/
  // viaDecision); a manual investor_interaction_log entry with no formal
  // decision/archive/match attached is the one signal that isn't. Same
  // missing-table-safe pattern as company_facts/ndas elsewhere — this
  // migration (0125) may not be applied in every environment yet.
  if (orgIds.length > 0 && investorCatalogEntityId && await interactionLogAvailable()) {
    const { data: logRows } = await admin.from('investor_interaction_log')
      .select('startup_org_id').eq('investor_catalog_entity_id', investorCatalogEntityId).in('startup_org_id', orgIds);
    const loggedOrgIds = new Set((logRows ?? []).map((r) => r.startup_org_id as string));
    for (const c of cards) if (loggedOrgIds.has(c.orgId as string)) c.hasManualInteractionLog = true;
  }

  // Prompt 345 §B — "Withdraw interest": whether the window is still open,
  // computed HERE (not lazily on expand) because P134-A's own acceptance
  // criterion is that expanding a card never fetches. Only for cards with a
  // REAL decision (decidedAt set — a legacy swipe-only 'like' predates
  // investor_relationship_decisions and was never tracked with a founder
  // task/notification to withdraw in the first place). Team emails resolved
  // once, reused for every such card, not once per card.
  const withdrawableCards = cards.filter((c) => c.status === 'interested' && c.decidedAt);
  if (withdrawableCards.length > 0 && investorCatalogEntityId) {
    const { data: teamRows } = await admin.from('matchdeal_investor_members').select('user_id')
      .eq('catalog_entity_id', investorCatalogEntityId).eq('status', 'active');
    const teamEmails = await Promise.all((teamRows ?? []).map(async (r) => {
      const { data } = await admin.auth.admin.getUserById(r.user_id as string);
      return data?.user?.email ?? null;
    }));
    const investorEmails = [...new Set([email, ...teamEmails.filter((e): e is string => !!e)])];
    await Promise.all(withdrawableCards.map(async (c) => {
      const signals = await resolveWithdrawWindowSignals(admin, {
        orgId: c.orgId as string, investorCatalogEntityId, decidedAt: c.decidedAt as string, investorEmails,
      });
      c.canWithdrawInterest = canWithdrawInterest(signals);
    }));
  }

  // P132-A — a relationship card (grant and/or decision) is never subject
  // to the discovery wave-gate: the relationship already exists, so there's
  // nothing left to "unlock" by treating other cards first. Only the
  // remaining discovery-only cards go through the original doseamento.
  // Prompt 153 — nor to the monthlyCap admission gate below, same reasoning:
  // a real grant/decision is consent that already happened, not a
  // discovery-quota spend.
  const relationshipCards = cards.filter((c) => c.viaGrant || c.viaDecision || c.viaReferral);
  const discoveryCards = cards.filter((c) => !c.viaGrant && !c.viaDecision && !c.viaReferral);

  // Prompt 153 — monthlyCap (plans.ts, by investor plan tier) now limits
  // how many NEW discovery candidates this investor firm is ever admitted
  // to, per calendar month; WAVE_SIZE (unchanged, below) still controls how
  // many of the admitted set are shown at once. Coexistence model, not
  // "WAVE_SIZE = monthlyCap" — confirmed with Nuno. investor_pipeline_admissions
  // (migration 0157) is what makes "new this month" answerable at all: this
  // function recomputes discoveryCards from scratch on every call, with no
  // other record of when a candidate first became visible.
  let admittedDiscoveryCards = discoveryCards;
  if (investorCatalogEntityId) {
    const { data: admissionRows } = await admin.from('investor_pipeline_admissions')
      .select('org_id, admitted_at').eq('investor_catalog_entity_id', investorCatalogEntityId);
    const admittedAtByOrg = new Map((admissionRows ?? []).map((a) => [a.org_id as string, a.admitted_at as string]));

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const admittedThisMonthCount = [...admittedAtByOrg.values()].filter((t) => t >= monthStart).length;

    // Prompt 402 — resolver centralized in portal-access.ts (same mapping,
    // same 'tier_a' fallback) so this and the startup dossier's Hype badge
    // gate can't drift into two different tier mappings.
    const planTier = await resolveInvestorPlanTierForProfile(admin, investorProfile.id as string);
    const monthlyCap = investorPlanRow(planTier).monthlyCap;

    let admissionBudget = Math.max(0, monthlyCap - admittedThisMonthCount);
    const newlyAdmitted: { investor_catalog_entity_id: string; org_id: string }[] = [];
    admittedDiscoveryCards = discoveryCards.filter((c) => {
      if (admittedAtByOrg.has(c.orgId)) return true;
      if (admissionBudget <= 0) return false;
      admissionBudget -= 1;
      newlyAdmitted.push({ investor_catalog_entity_id: investorCatalogEntityId, org_id: c.orgId });
      return true;
    });
    // Prompt 336 — this used to skip persisting admission for
    // is_ablute_developer() sessions (measured in production: the
    // "ablute_ — Internal QA" firm had eaten 4/10 of its tier's monthly
    // cap from dogfood swipes before that gate existed). Now that these
    // accounts are real investors, they're meant to have a real monthly
    // cap like anyone else — the gate is gone, admission persists
    // unconditionally.
    if (newlyAdmitted.length > 0) {
      // Idempotent by the table's own unique(investor_catalog_entity_id,
      // org_id) constraint — a concurrent call admitting the same
      // candidate is a harmless no-op, not a double-spend of the budget.
      await admin.from('investor_pipeline_admissions').upsert(newlyAdmitted, {
        onConflict: 'investor_catalog_entity_id,org_id', ignoreDuplicates: true,
      });
    }
  }

  const waves = [];
  if (relationshipCards.length > 0) {
    waves.push({ index: waves.length, items: relationshipCards, unlocked: true });
  }
  for (let i = 0; i < admittedDiscoveryCards.length; i += WAVE_SIZE) {
    const items = admittedDiscoveryCards.slice(i, i + WAVE_SIZE);
    const priorTreated = admittedDiscoveryCards.slice(0, i).every(isTreatedForWaveDosage);
    waves.push({ index: waves.length, items, unlocked: i === 0 || priorTreated });
  }

  // Prompt 556 §C — a closed org (orgs.closed_at, migration 0305) is
  // projected down to name + status here, at the LAST possible point, after
  // every enrichment step above has run. Doing it earlier would mean each
  // new enrichment has to remember to skip closed cards; doing it here means
  // none of them can leak, because nothing they wrote survives the
  // projection. A closed org can only still be in this list through HISTORY
  // (a recorded decision, an accepted referral) — discovery and grants both
  // exclude it upstream now.
  const closedIds = await closedOrgIds(admin, orgIds);
  const projectedWaves = closedIds.size === 0 ? waves : waves.map((w) => ({
    ...w,
    items: w.items.map((c) => (closedIds.has(c.orgId as string) ? projectUnavailableCard(c) : c)),
  }));

  return { linked: true as const, waves: projectedWaves, usualCoInvestors };
}
