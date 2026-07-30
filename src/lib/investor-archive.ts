// Investor Workspace Archive (prompt 60) — orchestration for creating an
// archive entry (from a pass, or manually) and computing reopen badges.
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureSnapshot } from './startup-snapshot';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';

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
