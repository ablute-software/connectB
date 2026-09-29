// Prompt 895 (v2) §0/§B.1 — RESTRICTED-SCOPE pure-function fit calculator.
//
// Read this before touching the weights or the hard criteria below.
//
// Nuno's own instruction on the full Prompt 895 (v2) spec: "começa pelo §0 e
// pela auditoria de recall §E ... e pára aí" — start with §0 and the §E
// recall audit, stop there. This file exists ONLY to make §E's recall audit
// computable. It is a pure function with no I/O, no Supabase import, and
// (as of this branch) exactly one caller: recall-audit.ts / the one-off
// audit script under scripts/. It is NOT wired into catalog_top_matches or
// any delivery path — §B.6 ("catalog_top_matches passa a usar catalog_fit")
// is explicitly out of scope here, same for §A (a real catalog_entity_facts
// table with source/tier per fact), §C (UI), §D (data repair) and §F
// (superseded by the separately-shipped Prompt 896 — not touched).
//
// WHAT THIS DOES vs. WHAT THE REAL §A/§B WOULD DO — read this before trusting
// a result. §A's design is "facts with a source and a coverage matrix"
// (catalog_entity_facts: area, value, source_url, source_tier, status). That
// table does not exist and this branch does not create it (no migration, no
// schema change, nothing applied to any database, ever). So this module
// reads the CURRENT catalog_entities/orgs columns directly and can only ever
// mark a §B.2 hard criterion `unknown` when the structured field it would
// need does not exist yet:
//
//   - `not_an_investor` needs an `entity_kind` field (vc_fund | cvc |
//     angel_network_association | accelerator | ...). catalog_entities has
//     NO such column (confirmed by grep + information_schema, 2026-09-29).
//     This criterion is accepted as an optional input for forward-compat but
//     is ALWAYS `unknown` (never fires) against real production data today.
//     A `warnings` entry says so on every call. A separate, best-effort,
//     thesis-keyword WARNING (never a hard exclusion) flags the specific
//     "association/angel body" false-positive shape the prompt names
//     (Investors Portugal) — labelled clearly as a heuristic, not the real
//     classification §A would produce.
//   - `excluded_by_thesis` needs a structured `exclusions` field (e.g. "no
//     hardware"). No such column exists either. Always `unknown`.
//   - `stage_out`, `ticket_out` use real columns (stage_min/max,
//     check_min/max_eur) that already exist and are populated for a real
//     subset of the catalog.
//   - `geography_out` uses the real `geographies` column (catalog_entities'
//     own "where do they invest" field, populated for ~22% of verified rows
//     per §0) — this is the §B.3-mandated fix for §0's failure #6
//     (the live production score uses hq_country only). `hq_country` is used
//     ONLY as a fallback in the SCORE, exactly as §B.3 specifies, never for
//     the hard exclusion itself (the spec ties the hard criterion to
//     invest_geographies/origin_constraints specifically).
//
// SECTOR NORMALIZATION — §0's failure #1, restricted fix. There is no
// general free-text-to-taxonomy normalizer in this codebase to reuse:
// src/lib/catalog-sector-fit.ts's own header comment documents this
// directly (a real fix was a one-time, manually-reviewed ~250-row SQL
// backfill, migration 0148, never replicated as reusable code — "duplicating
// real curation work, not reuse"). Per this task's own instruction, this
// file adds a MINIMAL, explicitly-scoped raw-token map below
// (RAW_SECTOR_TOKEN_MAP) covering only the tokens actually observed in
// production on the named example firms (Indico, Armilar, Portugal
// Ventures, Shilling, and a few more seen while pulling the audit data). It
// is not a taxonomy engine and must never be read as one — extending it to
// the other ~370 catalog rows with raw sector tokens is exactly the §A/§D
// work Nuno has not yet authorized.
//
// SCORING WEIGHTS — kept IDENTICAL to the live production function
// (`catalog_match_score`, migration 0345 — verified byte-for-byte against
// production on 2026-09-29 as part of this task's §0 re-verification; see
// DECISIONS.md) for every criterion that exists in both: sector 0/15/35,
// stage 12/25/10(near-miss), ticket 10/20/10(near-miss), geography
// 10/6/4/2. The ONE deliberate deviation, per this task's own instruction
// (§B.3): geography's "known" branch is evaluated against
// `geographies` (invest geographies) FIRST, falling back to `hq_country`
// only when `geographies` is empty/null — the live function only ever reads
// `hq_country`. This module also does NOT include the live function's
// Prompt 585 topic-signal bonus (+0..+8) — that is a separate, unrelated
// system (evidence-based topic matching) with its own tables, orthogonal to
// this restricted deliverable, and it is left out entirely rather than
// half-replicated.

export type Stage = 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'series_c_plus' | 'later' | 'other';

const STAGE_RANK: Partial<Record<Stage, number>> = {
  pre_seed: 1, seed: 2, series_a: 3, series_b: 4, series_c_plus: 5, later: 6,
};

export interface FitOrgInput {
  /** orgs.sectors — canonical taxonomy names (src/lib/sector-taxonomy.ts). */
  sectors: string[] | null | undefined;
  stage: Stage | null | undefined;
  round_min_ticket_eur: number | null | undefined;
  round_target_eur: number | null | undefined;
  /** orgs.country — free text, e.g. "Portugal" (confirmed 100% of real orgs, Prompt 139). */
  country: string | null | undefined;
}

export interface FitCatalogEntityInput {
  id?: string;
  name?: string;
  /** catalog_entities.sectors_normalized — mixed taxonomy labels AND raw lowercase tokens (§0 failure #1). */
  sectors_normalized: string[] | null | undefined;
  stage_min: Stage | null | undefined;
  stage_max: Stage | null | undefined;
  check_min_eur: number | null | undefined;
  check_max_eur: number | null | undefined;
  /** catalog_entities.geographies — where the firm actually invests. ~22% populated per §0. */
  geographies: string[] | null | undefined;
  /** catalog_entities.hq_country — ISO-2. Fallback only, per §B.3. */
  hq_country: string | null | undefined;
  thesis?: string | null;
  /**
   * Does NOT exist as a real column today (see file header). Accepted only
   * so a future caller backed by real §A data can pass it through; with no
   * value (the only case reachable against production today) the
   * `not_an_investor` hard criterion is always `unknown`.
   */
  entity_kind?: string | null;
}

export type FitHardReason =
  | 'not_an_investor'
  | 'stage_out'
  | 'ticket_out'
  | 'geography_out'
  | 'excluded_by_thesis';

export type FitAreaName = 'sector' | 'stage' | 'ticket' | 'geography';

export interface FitPart {
  area: FitAreaName;
  known: boolean;
  /** Points this area contributed. Informational even when the firm is hard-excluded (score is null in that case). */
  credit: number;
  detail: string;
}

export interface FitWarning {
  code: string;
  message: string;
}

export interface CatalogFitResult {
  eligible: boolean;
  hard_reasons: FitHardReason[];
  /** null when not eligible (hard-excluded) — a hard-excluded firm is not "scored" at all, per §B.1. */
  score: number | null;
  /** 0-100: % of the 4 scored areas (sector/stage/ticket/geography) that are `known`. */
  confidence: number;
  parts: FitPart[];
  warnings: FitWarning[];
}

// ---------------------------------------------------------------------------
// Minimal helpers — each documented as deliberately narrow, per file header.
// ---------------------------------------------------------------------------

// Mirrors public.normalize_country_code (migration 20260909053000) closely
// enough for this module's own comparisons — country NAME (orgs.country) to
// ISO-2, matching what the live function does for both sides since Prompt 627.
const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  portugal: 'PT', spain: 'ES', 'españa': 'ES', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
  germany: 'DE', deutschland: 'DE', france: 'FR', netherlands: 'NL', 'the netherlands': 'NL',
  switzerland: 'CH', sweden: 'SE', denmark: 'DK', finland: 'FI', norway: 'NO', ireland: 'IE',
  belgium: 'BE', italy: 'IT', austria: 'AT', luxembourg: 'LU', poland: 'PL', greece: 'GR',
  'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', romania: 'RO', bulgaria: 'BG', croatia: 'HR',
  slovenia: 'SI', slovakia: 'SK', estonia: 'EE', latvia: 'LV', lithuania: 'LT', iceland: 'IS',
  malta: 'MT', cyprus: 'CY', 'united states': 'US', usa: 'US', brazil: 'BR',
};

export function normalizeCountryCode(input: string | null | undefined): string | null {
  const v = (input ?? '').trim();
  if (!v) return null;
  if (v.length === 2) return v.toUpperCase();
  return COUNTRY_NAME_TO_ISO2[v.toLowerCase()] ?? null;
}

const WESTERN_EUROPE_CLUSTER = new Set(['GB', 'DE', 'FR', 'NL', 'CH', 'SE']);
const OTHER_EUROPE_CLUSTER = new Set([
  'DK', 'FI', 'NO', 'IE', 'BE', 'AT', 'IT', 'ES', 'PL', 'LU', 'GR', 'CZ', 'HU', 'RO', 'BG', 'HR',
  'SI', 'SK', 'EE', 'LV', 'LT', 'IS', 'MT', 'CY',
]);

// Deliberately small: geography free-text terms actually seen in production
// (DOMiNO's "Eastern Europe"/"Central Asia"/"Caucasus"/"Türkiye", BuenaVista's
// "Iberia", LINCE's "Portugal") plus the broad terms a real fund thesis uses
// when it means "anywhere in Europe". NOT a geography ontology — extending
// this to the full ~170 populated rows is §A/§D work, not this file's job.
//
// Split deliberately into SPECIFIC phrases (safe to substring-match — no
// unqualified region name can falsely contain them) and EXACT broad terms
// (matched only on an exact, trimmed, lower-cased equality). Substring-
// matching "europe" would silently swallow "Eastern Europe" as if it meant
// "covers Portugal" — precisely the false-negative this hard criterion
// exists to catch (the DOMiNO case). Caught by this module's own test suite.
const GEOGRAPHY_HOME_SPECIFIC_PHRASES: Record<string, string[]> = {
  PT: ['portugal', 'iberia', 'iberian peninsula', 'southern europe'],
};
const GEOGRAPHY_HOME_EXACT_BROAD_TERMS = ['europe', 'european union', 'eu', 'emea', 'global', 'worldwide', 'international'];

function geographyListIncludesHome(geographies: string[], orgCountry: string | null): boolean {
  if (!orgCountry) return false;
  const norm = geographies.map((g) => g.trim().toLowerCase());
  const specific = GEOGRAPHY_HOME_SPECIFIC_PHRASES[orgCountry] ?? [orgCountry.toLowerCase()];
  return norm.some((g) => specific.some((p) => g.includes(p)) || GEOGRAPHY_HOME_EXACT_BROAD_TERMS.includes(g));
}

// Minimal, explicitly-scoped raw-sector-token -> canonical taxonomy map. See
// file header. Canonical names copied verbatim from src/lib/sector-taxonomy.ts.
const RAW_SECTOR_TOKEN_MAP: Record<string, string[]> = {
  ai: ['AI, Data & Analytics'],
  ia: ['AI, Data & Analytics'],
  saas: ['Enterprise Software & SaaS'],
  software: ['Enterprise Software & SaaS'],
  enterprise: ['Enterprise Software & SaaS'],
  b2b: ['Enterprise Software & SaaS'],
  fintech: ['FinTech & InsurTech'],
  health: ['Digital Health', 'Healthcare Services & Clinical Research'],
  healthtech: ['Digital Health'],
  'deep tech': ['DeepTech'],
  deeptech: ['DeepTech'],
  'life sciences': ['Biotechnology & Life Sciences'],
  space: ['Aerospace & SpaceTech'],
  robotics: ['Robotics & Automation'],
  automation: ['Robotics & Automation'],
  cybersecurity: ['Cybersecurity'],
  devtools: ['Developer Tools & Cloud Infrastructure'],
  infrastructure: ['Developer Tools & Cloud Infrastructure', 'ConstructionTech & Infrastructure'],
  'dual use': ['Defence & Dual-Use'],
  ocean: ['BlueTech & OceanTech'],
  industry: ['IndustrialTech & Advanced Manufacturing'],
  tourism: ['TravelTech & Hospitality'],
  marketplaces: ['RetailTech & E-commerce'],
  consumer: ['Consumer Products & Services'],
  iot: ['Robotics & Automation'],
};

// Tokens that declare "we invest in everything" — credited as a sector match
// against ANY org profile, same reasoning src/lib/catalog-sector-fit.ts's
// GENERALIST_KEYWORDS already applies elsewhere in this codebase for a
// different comparison (free-text-vs-delivered-org sector fit).
const GENERALIST_SECTOR_TOKENS = new Set(['tecnologia generalista', 'generalista', 'generalist', 'tech at the core']);

function sectorsOverlap(catalogSectors: string[], orgSectors: string[]): boolean {
  const orgSet = new Set(orgSectors.map((s) => s.trim()));
  for (const raw of catalogSectors) {
    const trimmed = raw.trim();
    if (orgSet.has(trimmed)) return true;
    if (GENERALIST_SECTOR_TOKENS.has(trimmed.toLowerCase())) return true;
    const mapped = RAW_SECTOR_TOKEN_MAP[trimmed.toLowerCase()];
    if (mapped?.some((m) => orgSet.has(m))) return true;
  }
  return false;
}

// Best-effort, informational ONLY (never a hard_reason — see file header:
// `not_an_investor` needs a real `entity_kind` column that does not exist).
// Flags the exact shape §0 names (Investors Portugal: "National business
// angel body; coordinates the Portuguese angel plan.").
const NON_INVESTOR_THESIS_KEYWORDS = [
  'business angel body', 'national business angel', 'coordinates the', 'coordinates a',
  'trade association', 'trade body', 'chamber of commerce', 'federation of',
];

function looksLikeNonInvestorEntity(thesis: string | null | undefined): boolean {
  if (!thesis) return false;
  const t = thesis.toLowerCase();
  return NON_INVESTOR_THESIS_KEYWORDS.some((k) => t.includes(k));
}

function stageRank(s: Stage | null | undefined): number | null {
  if (!s || s === 'other') return null;
  return STAGE_RANK[s] ?? null;
}

// ---------------------------------------------------------------------------
// catalog_fit(org, catalog) — §B.1
// ---------------------------------------------------------------------------
export function catalogFit(org: FitOrgInput, cat: FitCatalogEntityInput): CatalogFitResult {
  const hardReasons: FitHardReason[] = [];
  const warnings: FitWarning[] = [];

  // --- not_an_investor (§B.2) — always unknown against real data today. ---
  if (cat.entity_kind == null) {
    warnings.push({
      code: 'entity_kind_unknown',
      message: 'not_an_investor cannot be evaluated: catalog_entities has no entity_kind column today (§A gap).',
    });
    if (looksLikeNonInvestorEntity(cat.thesis)) {
      warnings.push({
        code: 'possible_non_investor_entity_kind',
        message: 'Thesis text reads like an association/coordinating body, not a fund with its own cheque — heuristic only, not a hard exclusion (needs real entity_kind, §A).',
      });
    }
  } else if (['angel_network_association', 'accelerator', 'other'].includes(cat.entity_kind)) {
    hardReasons.push('not_an_investor');
  }

  // --- excluded_by_thesis (§B.2) — always unknown: no structured exclusions field. ---
  warnings.push({
    code: 'exclusions_unknown',
    message: 'excluded_by_thesis cannot be evaluated: no structured exclusions field exists yet (§A gap) — thesis text is not parsed for this.',
  });

  // --- stage (§B.2 stage_out, §B.3 score) ---
  const stageKnown = cat.stage_min != null || cat.stage_max != null;
  const orgRank = stageRank(org.stage);
  let stageCredit = 0;
  let stageDetail: string;
  if (!stageKnown) {
    stageCredit = 12;
    stageDetail = 'Firm has no declared stage range — treated as unknown, not a match (unknown never scores like a real match).';
  } else if (org.stage === 'other' || cat.stage_min === 'other' || cat.stage_max === 'other' || orgRank == null) {
    stageCredit = 12;
    stageDetail = 'Org stage or firm range includes the "other" wildcard — cannot be compared numerically.';
  } else {
    const lo = stageRank(cat.stage_min) ?? 1;
    const hi = stageRank(cat.stage_max) ?? 6;
    if (orgRank >= lo && orgRank <= hi) {
      stageCredit = 25;
      stageDetail = `Org stage rank ${orgRank} within firm's [${lo}, ${hi}].`;
    } else {
      const dist = Math.min(Math.abs(orgRank - lo), Math.abs(orgRank - hi));
      if (dist > 1) hardReasons.push('stage_out');
      stageCredit = dist === 1 ? 10 : 0;
      stageDetail = `Org stage rank ${orgRank} outside firm's [${lo}, ${hi}] by ${dist} step(s).`;
    }
  }

  // --- ticket (§B.2 ticket_out, §B.3 score) ---
  const ticketKnown = cat.check_min_eur != null && cat.check_max_eur != null;
  const orgTicket = org.round_min_ticket_eur ?? org.round_target_eur ?? null;
  let ticketCredit = 0;
  let ticketDetail: string;
  if (!ticketKnown || orgTicket == null) {
    ticketCredit = 10;
    ticketDetail = orgTicket == null
      ? 'Org has no ticket size declared — treated as unknown.'
      : 'Firm has no declared cheque range — treated as unknown.';
  } else {
    const lo = cat.check_min_eur as number;
    const hi = cat.check_max_eur as number;
    if (orgTicket >= lo && orgTicket <= hi) {
      ticketCredit = 20;
      ticketDetail = `Org ticket €${orgTicket.toLocaleString()} within firm's [€${lo.toLocaleString()}, €${hi.toLocaleString()}].`;
    } else if ((orgTicket < lo && orgTicket * 2 >= lo) || (orgTicket > hi && orgTicket <= hi * 2)) {
      ticketCredit = 10;
      ticketDetail = `Org ticket €${orgTicket.toLocaleString()} within 2x of firm's [€${lo.toLocaleString()}, €${hi.toLocaleString()}].`;
    } else {
      ticketCredit = 0;
      ticketDetail = `Org ticket €${orgTicket.toLocaleString()} more than 2x outside firm's [€${lo.toLocaleString()}, €${hi.toLocaleString()}].`;
      if (orgTicket < lo / 2 || orgTicket > hi * 2) hardReasons.push('ticket_out');
    }
  }

  // --- geography (§B.2 geography_out, §B.3 score — invest_geographies first, hq_country fallback) ---
  const geographiesKnown = !!cat.geographies && cat.geographies.length > 0;
  const orgCC = normalizeCountryCode(org.country);
  let geoCredit = 0;
  let geoDetail: string;
  let geoKnownForConfidence = geographiesKnown;
  if (geographiesKnown) {
    const geos = cat.geographies as string[];
    const includesHome = geographyListIncludesHome(geos, orgCC);
    if (includesHome) {
      geoCredit = 10;
      geoDetail = `Firm's declared invest_geographies (${geos.join(', ')}) include the org's country/region.`;
    } else {
      // §B.2 is explicit: invest_geographies KNOWN and the org's country is
      // OUT is a hard exclusion — there is no soft "nearby region" tier once
      // the firm has told us where it actually invests. (An earlier version
      // of this file scored "Eastern Europe"/"Western Europe" as a lesser
      // credit here, the same tiering the hq_country FALLBACK below uses —
      // that's wrong for a KNOWN invest_geographies list: it silently
      // rescued exactly the DOMiNO case this criterion exists to catch. The
      // softer tiering is only correct for the hq_country fallback, where
      // "nearby hub" is a weak proxy signal, not a declared fact.)
      geoCredit = 0;
      geoDetail = `Firm's declared invest_geographies (${geos.join(', ')}) do not include the org's country/region.`;
      hardReasons.push('geography_out');
    }
  } else if (orgCC && cat.hq_country) {
    // Fallback per §B.3 — hq_country ONLY, never the basis for a hard exclusion.
    geoKnownForConfidence = true;
    const ec = normalizeCountryCode(cat.hq_country);
    if (ec && ec === orgCC) {
      geoCredit = 10;
      geoDetail = `No invest_geographies on record — falling back to hq_country: same country as org (${ec}).`;
    } else if (ec && WESTERN_EUROPE_CLUSTER.has(ec)) {
      geoCredit = 6;
      geoDetail = `No invest_geographies on record — falling back to hq_country: Western-Europe hub (${ec}).`;
    } else if (ec && OTHER_EUROPE_CLUSTER.has(ec)) {
      geoCredit = 4;
      geoDetail = `No invest_geographies on record — falling back to hq_country: other Europe (${ec}).`;
    } else {
      geoCredit = 2;
      geoDetail = `No invest_geographies on record — falling back to hq_country: ${ec ?? cat.hq_country ?? 'unrecognised'}.`;
    }
  } else {
    geoCredit = 5;
    geoKnownForConfidence = false;
    geoDetail = 'No invest_geographies and no usable hq_country/org country — treated as fully unknown.';
  }

  const parts: FitPart[] = [
    { area: 'sector', known: !!cat.sectors_normalized && cat.sectors_normalized.length > 0, credit: 0, detail: '' },
    { area: 'stage', known: stageKnown, credit: stageCredit, detail: stageDetail },
    { area: 'ticket', known: ticketKnown && orgTicket != null, credit: ticketCredit, detail: ticketDetail },
    { area: 'geography', known: geoKnownForConfidence, credit: geoCredit, detail: geoDetail },
  ];

  // --- sector (§B.2 is silent on a sector hard-exclusion — score only) ---
  const sectorPart = parts[0];
  if (!sectorPart.known) {
    sectorPart.credit = 15;
    sectorPart.detail = 'Firm has no declared/normalized sectors — treated as unknown, not a match.';
  } else if (sectorsOverlap(cat.sectors_normalized as string[], org.sectors ?? [])) {
    sectorPart.credit = 35;
    sectorPart.detail = `Sector overlap found (normalizer applied — see file header) between [${(cat.sectors_normalized ?? []).join(', ')}] and org sectors [${(org.sectors ?? []).join(', ')}].`;
  } else {
    sectorPart.credit = 0;
    sectorPart.detail = `No sector overlap between [${(cat.sectors_normalized ?? []).join(', ')}] and org sectors [${(org.sectors ?? []).join(', ')}], even after the minimal raw-token normalizer.`;
  }

  const eligible = hardReasons.length === 0;
  const rawScore = parts.reduce((sum, p) => sum + p.credit, 0);
  const score = eligible ? Math.max(0, Math.min(100, rawScore)) : null;
  const knownCount = parts.filter((p) => p.known).length;
  const confidence = Math.round((knownCount / parts.length) * 100);

  return { eligible, hard_reasons: hardReasons, score, confidence, parts, warnings };
}
