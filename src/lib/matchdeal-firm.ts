// Prompt 555 — the founder-safe shape of an investor FIRM, as returned by
// matchdeal_investor_firm_view (migration 0302).
//
// Why this type exists at all: the founder's entity page used to resolve "the
// investor's own MatchDeal profile" through entity-catalog-prefill.ts, which
// matches against catalog_entities. For an investor who came FROM the catalog
// that is nearly right; for a SELF-REGISTERED one the catalog row is a stub
// created only to hang the membership off, and the real data lives in
// matchdeal_profiles — one row per firm member. So the page was reading an
// empty row and rendering an empty dossier while the investor's profile sat
// filled in a table nothing on the founder side ever touched.
//
// Every field here is already shown to founders on the MatchDeal deck
// (MatchDealDeck.tsx), honouring hidden_fields. Nothing is newly exposed.
// A hidden field is ABSENT from this object, never present-and-null.
export interface MatchDealFirmPerson {
  full_name: string;
  title?: string;
  linkedin_url?: string;
  /** 1 = the profile's named representative, 2 = a firm member. */
  seniority?: number;
}

export interface MatchDealFirm {
  entity_name?: string;
  entity_type?: string;
  entity_logo_url?: string;
  website?: string;
  country?: string;
  geographies?: string[];
  description?: string;
  sectors?: string[];
  focus_keywords?: string[];
  stages_invested?: string[];
  phases_accepted?: string[];
  company_types?: string[];
  ticket_min?: number;
  ticket_max?: number;
  capital_to_deploy_eur?: number;
  investments_per_year?: number;
  lead_or_colead?: string;
  instruments?: string[];
  does_follow_on?: boolean;
  takes_board_seat?: string;
  typical_decision_weeks?: number;
  decision_process?: string;
  active_fund?: string;
  portfolio_companies?: string;
  recent_investments?: string;
  usual_co_investors?: string;
  exclusions_sectors?: string[];
  exclusions_notes?: string;
  specific_criteria?: string;
  accepts_cold_contact?: boolean;
  preferred_contact_channel?: string;
  /** The investor's OWN typed contact. Never auth.users.email. */
  contact?: string;
  people?: MatchDealFirmPerson[];
}

// MatchDeal's stage vocabulary -> the CRM's Stage union. The SQL side encodes
// the same mapping (matchdeal_stage_to_crm, migration 0302); this is the read
// path's copy for rendering a range the founder has not overridden.
// series_b_plus and growth both collapse to 'later' — the CRM has no finer
// bucket (types.ts:9).
const STAGE_ORDER = ['pre_seed', 'seed', 'series_a', 'series_b_plus', 'growth'] as const;
const STAGE_TO_CRM: Record<string, 'pre_seed' | 'seed' | 'series_a' | 'later'> = {
  pre_seed: 'pre_seed', seed: 'seed', series_a: 'series_a',
  series_b_plus: 'later', growth: 'later',
};

export function firmStageRange(firm: MatchDealFirm | null): { min?: 'pre_seed' | 'seed' | 'series_a' | 'later'; max?: 'pre_seed' | 'seed' | 'series_a' | 'later' } {
  const known = (firm?.stages_invested ?? []).filter((s) => s in STAGE_TO_CRM);
  if (known.length === 0) return {};
  const sorted = [...known].sort(
    (a, b) => STAGE_ORDER.indexOf(a as typeof STAGE_ORDER[number]) - STAGE_ORDER.indexOf(b as typeof STAGE_ORDER[number]),
  );
  return { min: STAGE_TO_CRM[sorted[0]], max: STAGE_TO_CRM[sorted[sorted.length - 1]] };
}

/** True when the firm carries anything worth rendering in the profile card. */
export function firmHasProfileDetail(firm: MatchDealFirm | null): boolean {
  if (!firm) return false;
  return [
    firm.instruments?.length, firm.lead_or_colead, firm.does_follow_on !== undefined,
    firm.takes_board_seat, firm.typical_decision_weeks, firm.decision_process,
    firm.active_fund, firm.portfolio_companies, firm.recent_investments,
    firm.usual_co_investors, firm.exclusions_sectors?.length, firm.exclusions_notes,
    firm.preferred_contact_channel, firm.accepts_cold_contact !== undefined,
    firm.capital_to_deploy_eur, firm.investments_per_year, firm.geographies?.length,
    firm.focus_keywords?.length, firm.company_types?.length, firm.phases_accepted?.length,
  ].some(Boolean);
}
