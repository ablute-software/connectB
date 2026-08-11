// P136 — the disclosure ladder (Nuno's decision C, addenda 2026-08-06).
// Governs ONLY dossier fields — documents/access_grants and the matching
// engine are untouched, and this ladder ends exactly where they begin
// (level 4 = the existing NDA/access_grants flow, unchanged).
//
// Level 1 IS investor_relationship_decisions' own 'interested' decision —
// deliberately not re-materialized in investor_interest_levels (that would
// create two places asserting the same fact, and they'd eventually
// disagree). Levels 2/3 live in investor_interest_levels (migration 0131).
import type { SwotData, RoadmapPeriodKind } from './types';
import type { ReviewCategory } from './review-clarifications';

// Prompt 167 §C.5 — explicit field-by-field projection, same discipline as
// FounderClarificationFull above: period_kind/period_year/period_quarter/
// items only, never created_at/updated_at/sort_order or any other internal
// column off company_roadmap_milestones.
export interface RoadmapMilestoneFull {
  period_kind: RoadmapPeriodKind;
  period_year: number;
  period_quarter?: number;
  items: string[];
}

// Prompt 168 §D — the narrow shape that ever reaches an investor: category
// (as a caption, e.g. "Re: a weakness") + the clarification text itself.
// Never item_text (the original bullet — negative categories stay
// completely out of the investor's view, even through a clarification that
// responds to one) and never any other review_clarifications column.
export interface FounderClarificationFull { category: ReviewCategory; text: string }

export type InterestLevel = 0 | 1 | 2 | 3;
export type LevelStatus = 'granted' | 'pending' | 'denied';
export interface InterestLevelRow { level: 2 | 3; status: LevelStatus }

// §3 of prompt_136 — level 2 is granted the instant the investor asks for
// it (frictionless; the value for the founder is the SIGNAL, not a gate).
// Level 3 requires founder approval. A `passed` relationship decision
// COLLAPSES the effective level to 0 regardless of any granted row —
// checked here, in the one function every caller goes through, not left to
// each call site to remember. A level-3 row of ANY status (not just
// granted) implies level 2 was already reached, since the real workflow
// never lets an investor request level 3 without already holding level 2 —
// a pure function shouldn't have to trust that invariant is upheld
// elsewhere, so it's encoded directly here.
export function currentInterestLevel(decision: 'interested' | 'passed' | null, rows: InterestLevelRow[]): InterestLevel {
  if (decision === 'passed') return 0;
  if (rows.some((r) => r.level === 3 && r.status === 'granted')) return 3;
  if (rows.some((r) => r.level === 2 && r.status === 'granted') || rows.some((r) => r.level === 3)) return 2;
  if (decision === 'interested') return 1;
  return 0;
}

export interface TeamMemberFull { id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null; email: string | null }
export interface ContactHistoryEntryFull { id: string; at: string; content: string; channel: string | null }
export interface DocumentTitleFull { id: string; name: string }
export interface OverviewFull {
  description: string | null; sectors: string[]; stage: string | null; foundedYear: number | null;
  hqCity: string | null; country: string | null; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis: 'pre_money' | 'post_money' | null; roundMinTicketEur: number | null; roundInstruments: string[];
}

export interface FullDossierData {
  // Intersected with Record<string, unknown> — the real route passes
  // through the existing, richer matchdeal_startup_pitch_data RPC shape
  // (tam_eur, founders[], team_summary, etc.) unchanged; OverviewFull only
  // pins down the fields projectDossier's own tests care about.
  overview: OverviewFull & Record<string, unknown>;
  tractionDetailed: Record<string, unknown>;
  team: TeamMemberFull[];
  contactHistory: ContactHistoryEntryFull[];
  documentTitles: DocumentTitleFull[];
}

// §6's own table, as data — the single place that decides which top-level
// keys exist at which level. The test suite asserts projectDossier's own
// output keys against this exact list, so the two can never silently drift
// apart (prompt_136 §10.3's own requirement).
//
// Prompt 166 §D — `swot` is deliberately NOT listed here. Unlike every key
// below, it isn't purely level-gated: it also needs the founder's own
// swot_visible_to_investors toggle to be on (a per-org fact, not a level),
// so a static "present at level N" table can't describe it. It's handled by
// its own explicit `swot` param on projectDossier instead — see there.
// Prompt 167 §C — `roadmap` is the same shape of exception, for the same
// reason (roadmap_visible_to_investors).
export const LEVEL_FIELDS: Record<InterestLevel, string[]> = {
  0: [],
  1: ['overview'],
  2: ['overview', 'tractionDetailed', 'team', 'contactHistory', 'documentTitles'],
  3: ['overview', 'tractionDetailed', 'team', 'contactHistory', 'documentTitles', 'canMessageNamedPerson', 'canRequestDataRoom'],
};

// The security-critical function: builds a DIFFERENT response object per
// level, never the full object with fields hidden client-side. A field
// that isn't unlocked is not merely falsy or empty — its KEY IS ABSENT
// from the returned object, so nothing ever reaches the browser before
// it's actually disclosed. Emails are the one field excluded from `team`
// even at level 3 unless shareEmail is explicitly true (that flag lives on
// the level-3 row itself, decided in the same founder approval dialog,
// checked separately — an email is a copy, not a view, and never rides
// along with the rest of level 3 "for free").
export function projectDossier(
  level: InterestLevel, full: FullDossierData, shareEmail: boolean,
  // Prompt 166 §D.5 — deliberately just the 4 bullet arrays, never the
  // route's own review_runs.report row: the caller (route.ts) is
  // responsible for projecting the report down to SwotData BEFORE it ever
  // reaches here, so score/summary/risks/recommendations/company_facts have
  // no path into this function's input at all, let alone its output.
  swot?: { visible: boolean; data: SwotData } | null,
  // Prompt 168 §D — already filtered to visible_to_investors=true rows by
  // the caller (route.ts queries WHERE visible_to_investors = true, so a
  // hidden clarification never even leaves the database, let alone reaches
  // this function). §D's own spec: "if N=0, the section doesn't appear at
  // all" — an empty/absent array both mean "don't add the key", not "add an
  // empty list", so the investor page's own `count > 0` check never needs
  // to distinguish the two.
  founderClarifications?: FounderClarificationFull[] | null,
  // Prompt 167 §C — same visible+level gate shape as swot above (a per-org
  // toggle, not purely level-derived, so — like swot — deliberately absent
  // from the static LEVEL_FIELDS table). Unlike founderClarifications,
  // there's no "hide if empty" rule here: a roadmap with zero milestones
  // yet still shows the (always-present) founding node, so an empty array
  // is a legitimate, real state to project, not a signal to omit the key.
  roadmap?: { visible: boolean; milestones: RoadmapMilestoneFull[] } | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { level };
  if (level >= 1) out.overview = full.overview;
  // Checked again here (visible AND level >= 1), not just trusted from the
  // caller — same "the security-critical function doesn't trust a single
  // call site" discipline as the shareEmail gate below.
  if (level >= 1 && swot?.visible && swot.data) out.swot = swot.data;
  if (level >= 1 && founderClarifications && founderClarifications.length > 0) out.founderClarifications = founderClarifications;
  if (level >= 1 && roadmap?.visible) out.roadmap = roadmap.milestones;
  if (level >= 2) {
    out.tractionDetailed = full.tractionDetailed;
    out.team = full.team.map((p) => (shareEmail && level >= 3
      ? { id: p.id, fullName: p.fullName, title: p.title, isFounder: p.isFounder, linkedinUrl: p.linkedinUrl, email: p.email }
      : { id: p.id, fullName: p.fullName, title: p.title, isFounder: p.isFounder, linkedinUrl: p.linkedinUrl }));
    out.contactHistory = full.contactHistory;
    out.documentTitles = full.documentTitles;
  }
  if (level >= 3) {
    out.canMessageNamedPerson = true;
    out.canRequestDataRoom = true;
  }
  return out;
}
