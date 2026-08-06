// P136 — the disclosure ladder (Nuno's decision C, addenda 2026-08-06).
// Governs ONLY dossier fields — documents/access_grants and the matching
// engine are untouched, and this ladder ends exactly where they begin
// (level 4 = the existing NDA/access_grants flow, unchanged).
//
// Level 1 IS investor_relationship_decisions' own 'interested' decision —
// deliberately not re-materialized in investor_interest_levels (that would
// create two places asserting the same fact, and they'd eventually
// disagree). Levels 2/3 live in investor_interest_levels (migration 0131).
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
export function projectDossier(level: InterestLevel, full: FullDossierData, shareEmail: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { level };
  if (level >= 1) out.overview = full.overview;
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
