// Investor Workspace Archive (prompt 60) — orchestration for creating an
// archive entry (from a pass, or manually) and computing reopen badges.
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureSnapshot } from './startup-snapshot';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';
import { resolveInvestorCatalogEntityId, resolveInvestorProfile } from './portal-access';

export async function createArchiveEntry(
  admin: SupabaseClient, orgId: string, investorEmail: string,
  source: 'pass' | 'round_closed' | 'manual', reasonDetail: string | null,
) {
  // Idempotent: re-passing an already-archived (org, investor) pair (e.g.
  // changing the pass reason) updates the existing active entry instead of
  // violating investor_archive_one_active_per_pair with a second insert.
  const { data: active } = await admin.from('investor_archive_entries')
    .select('id').eq('org_id', orgId).eq('investor_email', investorEmail).is('reopened_at', null).maybeSingle();
  if (active) {
    const { error } = await admin.from('investor_archive_entries').update({ reason_detail: reasonDetail }).eq('id', active.id);
    return { error };
  }

  // "First contact" = the earliest snapshot on record for this (org,
  // investor) pair, across every archive cycle (archive -> reopen ->
  // re-archive) — reused, never recaptured, so it stays the true earliest
  // point even on a second or third archive cycle.
  const { data: priorEntry } = await admin.from('investor_archive_entries')
    .select('first_contact_snapshot_id').eq('org_id', orgId).eq('investor_email', investorEmail)
    .order('archived_at', { ascending: true }).limit(1).maybeSingle();

  const firstContactSnapshotId = priorEntry
    ? (priorEntry.first_contact_snapshot_id as string)
    : (await captureSnapshot(admin, orgId, 'first_contact')).id;

  const { id: archivedSnapshotId } = await captureSnapshot(admin, orgId, 'archived');

  const { error } = await admin.from('investor_archive_entries').insert({
    org_id: orgId, investor_email: investorEmail, source, reason_detail: reasonDetail,
    first_contact_snapshot_id: firstContactSnapshotId, archived_snapshot_id: archivedSnapshotId,
  });
  return { error };
}

// Initial badge set (prompt asks to propose): kept to signals the platform
// can compute honestly from data already on hand — no fabricated "hotness"
// score. matchdeal_startup_hype is the one existing external-ish signal
// (MatchDeal's own like/growth/approval-rate view) — reused, not rebuilt.
export interface ArchiveBadges {
  raisedSinceYouPassed: boolean; newRoundOpen: boolean; nowMatchesThesis: boolean; trending: boolean;
}

export async function computeBadges(
  admin: SupabaseClient, orgId: string, archivedData: Record<string, unknown>, thesis: InvestorThesis | null,
): Promise<ArchiveBadges> {
  const { data: current } = await admin.from('orgs').select(
    'round_secured_eur, round_raising, round_target_close_date, stage, sectors, country, round_target_eur, round_min_ticket_eur, round_instruments',
  ).eq('id', orgId).single();

  const { data: soft } = await admin.from('investor_soft_commits').select('amount_eur').eq('org_id', orgId).eq('confirmed_by_founder', true);
  const currentSecured = (current?.round_secured_eur as number | null ?? 0) + (soft ?? []).reduce((s, c) => s + (c.amount_eur as number), 0);
  const archivedSecured = (archivedData.round_secured_eur as number | null) ?? 0;

  const raisedSinceYouPassed = currentSecured > archivedSecured;
  const newRoundOpen = !!current?.round_raising && !archivedData.round_raising;

  let nowMatchesThesis = false;
  if (thesis && current) {
    const round: StartupRound = {
      sectors: current.sectors ?? [], stage: current.stage, country: current.country,
      roundTargetEur: current.round_target_eur, roundMinTicketEur: current.round_min_ticket_eur,
      roundInstruments: current.round_instruments ?? [],
    };
    nowMatchesThesis = computeMatchScore(thesis, round).score >= 50;
  }

  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  let trending = false;
  if (startupProfile) {
    const { data: hype } = await admin.from('matchdeal_startup_hype').select('is_hype').eq('startup_profile_id', startupProfile.id).maybeSingle();
    trending = !!hype?.is_hype;
  }

  return { raisedSinceYouPassed, newRoundOpen, nowMatchesThesis, trending };
}

// Extracted so the CSV export (prompt 62.4) can reuse the exact same
// then/now/badges computation the Archive tab itself uses.
export async function getArchiveEntries(admin: SupabaseClient, userId: string, email: string) {
  const { data: entries } = await admin.from('investor_archive_entries')
    .select('id, org_id, source, reason_detail, archived_at, first_contact_snapshot_id, archived_snapshot_id')
    .eq('investor_email', email).is('reopened_at', null).order('archived_at', { ascending: false });
  if (!entries || entries.length === 0) return [];

  const orgIds = [...new Set(entries.map((e) => e.org_id as string))];
  const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const snapshotIds = [...new Set(entries.flatMap((e) => [e.first_contact_snapshot_id, e.archived_snapshot_id] as string[]))];
  const { data: snapshots } = await admin.from('startup_profile_snapshots').select('id, data, captured_at').in('id', snapshotIds);
  const snapshotById = new Map((snapshots ?? []).map((s) => [s.id as string, s]));

  const { data: nowSummaries } = await admin.from('startup_now_summaries').select('org_id, summary_text, generated_at').in('org_id', orgIds);
  const nowByOrg = new Map((nowSummaries ?? []).map((s) => [s.org_id as string, s]));

  const investorProfile = await resolveInvestorProfile(admin, userId);
  const thesis: InvestorThesis | null = investorProfile ? {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
    exclusionsSectors: investorProfile.exclusions_sectors, exclusionsNotes: investorProfile.exclusions_notes,
  } : null;

  // AP-10 — once the ORG has passed (investor_relationship_decisions,
  // authoritative over this per-email archive table), the investor's own
  // view of that entry restricts back down to name/reason/tag: continuing
  // to show the full then/now diligence snapshot to someone who already
  // declined would defeat the point of a final, non-reversible decision
  // (AP-06 — no changing Interested<->Passed after the fact).
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  const { data: decisions } = investorCatalogEntityId
    ? await admin.from('investor_relationship_decisions').select('org_id, decision')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('decision', 'passed').in('org_id', orgIds)
    : { data: [] as { org_id: string }[] };
  const passedOrgIds = new Set((decisions ?? []).map((d) => d.org_id as string));

  return Promise.all(entries.map(async (e) => {
    const orgId = e.org_id as string;
    const restricted = passedOrgIds.has(orgId);
    if (restricted) {
      return {
        id: e.id as string, orgId, orgName: orgNameById.get(orgId) ?? 'Unknown',
        source: e.source as string, reasonDetail: e.reason_detail as string | null, archivedAt: e.archived_at as string,
        restricted: true as const, firstContact: null, lastContact: null, now: null, badges: null,
      };
    }
    const firstContact = snapshotById.get(e.first_contact_snapshot_id as string);
    const lastContact = snapshotById.get(e.archived_snapshot_id as string);
    const now = nowByOrg.get(orgId);
    const badges = lastContact ? await computeBadges(admin, orgId, lastContact.data as Record<string, unknown>, thesis) : null;
    return {
      id: e.id as string, orgId, orgName: orgNameById.get(orgId) ?? 'Unknown',
      source: e.source as string, reasonDetail: e.reason_detail as string | null, archivedAt: e.archived_at as string,
      restricted: false as const,
      firstContact: firstContact ? { data: firstContact.data, capturedAt: firstContact.captured_at } : null,
      lastContact: lastContact ? { data: lastContact.data, capturedAt: lastContact.captured_at } : null,
      now: now ? { text: now.summary_text as string, generatedAt: now.generated_at as string } : null,
      badges,
    };
  }));
}
