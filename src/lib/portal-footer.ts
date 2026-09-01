// Prompt 523 — the /portal footer read "Every access is logged. ablute_ ·
// Seed Round 2026", with BOTH halves hard-coded.
//
// Two separate bugs in one line:
//   1. "ablute_" — every investor saw one founder's company name, whichever
//      startup's data room they were actually in. Prompt 515 fixed the same
//      shape of bug in this page's header, but that fix was the PRODUCT
//      brand (LogoLockup / brand.ts), which is deliberately NOT what happens
//      here: this half of the line is about the startup whose room this is,
//      not about Sherlock Deal. "sherlockdeal · Seed round · €1.3M" would
//      attach the round to the product, which is plainly wrong. So the fix
//      is the startup's real name, resolved per viewer.
//   2. "Seed Round 2026" — a literal that silently goes stale the moment the
//      round changes tier or year.
//
// The year is dropped rather than derived. There is no "round year" field in
// the schema and inventing one is not on. round_target_close_date is the only
// nearby real column, but it is a TARGET CLOSE DATE, not the year the round
// belongs to — rendering it as a year would be a quiet lie. Stage + amount
// already carries the meaning the line was there for.
//
// PRIVACY, non-negotiable (CLAUDE.md root rule): this is an INVESTOR-FACING
// surface, so only round_target_eur may appear. That is the ask, and the ask
// is the pitch. round_secured_eur — progress AGAINST the ask — is founder-
// private and gated behind orgs.round_progress_visible_to_investors; it is
// deliberately not read here, and must never be added to this line.

// The portal's own stage vocabulary. Deliberately NOT merged with the
// STAGE_LABELS map duplicated across PipelinePanel / InvestorProfilePanel /
// ComparisonView / portal/startup/[orgId] / MatchDealDeck and others: those
// carry {pre_seed, seed, series_a, series_b_plus, growth}, while the portal
// snapshot's vocabulary is {pre_seed, seed, series_a, later} PLUS an 'other'
// escape hatch backed by a free-text stage_other column. They look alike and
// are not — folding them into one shared map would silently relabel stages,
// so this stays the portal's own. (Prompt 523 suggested extracting a shared
// map; measured, that is not a trivial cleanup, it is a wrong one.)
export const PORTAL_STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', later: 'Later',
};

export interface PortalFooterSnapshot {
  name?: string | null;
  stage?: string | null;
  stage_other?: string | null;
  round_target_eur?: number | null;
}

export function portalStageLabel(s: PortalFooterSnapshot | null | undefined): string | null {
  if (!s?.stage) return null;
  if (s.stage === 'other') return s.stage_other?.trim() || null;
  return PORTAL_STAGE_LABELS[s.stage] ?? s.stage;
}

/**
 * The part of the footer after "Every access is logged." — empty string when
 * there is nothing truthful to say.
 *
 * Every piece is independently optional, because PortalSnapshot's fields are
 * all nullable on purpose: a genuinely-unset value must render as absent,
 * never as a fabricated zero or an "undefined". A snapshot with a name but no
 * round gives just the name; no snapshot at all (demo mode, or before the
 * fetch resolves) gives nothing, and the sentence stands on its own.
 */
export function portalFooterSuffix(
  s: PortalFooterSnapshot | null | undefined,
  fmtEur: (n: number) => string,
): string {
  const stage = portalStageLabel(s);
  const round = [
    stage ? `${stage} round` : null,
    s?.round_target_eur != null ? fmtEur(s.round_target_eur) : null,
  ].filter(Boolean).join(' · ');
  return [s?.name?.trim() || null, round || null].filter(Boolean).join(' · ');
}
