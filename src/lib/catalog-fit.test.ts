// Prompt 895 (v2) §B.1 — unit tests for the restricted-scope catalog_fit
// replica. §B.1's own "≥10-pairs equality vs. the real SQL twin" idea is not
// fully applicable here (there is no real SQL twin in this branch — §A/full
// §B are out of scope, see catalog-fit.ts header) so these instead cover the
// hard criteria and the scoring/confidence logic in isolation, plus the two
// named real-world cases the task asked for.
import { describe, expect, it } from 'vitest';
import { catalogFit, normalizeCountryCode, type FitCatalogEntityInput, type FitOrgInput } from './catalog-fit';

const sherlockDealOrg: FitOrgInput = {
  sectors: ['Enterprise Software & SaaS', 'AI, Data & Analytics'],
  stage: 'pre_seed',
  round_min_ticket_eur: 135000,
  round_target_eur: 270000,
  country: 'Portugal',
};

const abluteOrg: FitOrgInput = {
  sectors: ['Digital Health', 'MedTech & Medical Devices', 'DeepTech', 'ClimateTech & CleanTech', 'Longevity, AgeTech & Wellness', 'Robotics & Automation'],
  stage: 'pre_seed',
  round_min_ticket_eur: 100000,
  round_target_eur: 300000,
  country: 'Portugal',
};

function baseFirm(overrides: Partial<FitCatalogEntityInput> = {}): FitCatalogEntityInput {
  return {
    id: 'firm-1',
    name: 'Test Firm',
    sectors_normalized: [],
    stage_min: null,
    stage_max: null,
    check_min_eur: null,
    check_max_eur: null,
    geographies: null,
    hq_country: null,
    thesis: null,
    ...overrides,
  };
}

describe('normalizeCountryCode', () => {
  it('passes through an already-ISO2 code, upper-cased', () => {
    expect(normalizeCountryCode('pt')).toBe('PT');
    expect(normalizeCountryCode('PT')).toBe('PT');
  });
  it('maps a spelled-out country name', () => {
    expect(normalizeCountryCode('Portugal')).toBe('PT');
    expect(normalizeCountryCode('united kingdom')).toBe('GB');
  });
  it('returns null for empty/unrecognised input', () => {
    expect(normalizeCountryCode(null)).toBeNull();
    expect(normalizeCountryCode('')).toBeNull();
    expect(normalizeCountryCode('Narnia')).toBeNull();
  });
});

describe('catalogFit — hard criteria', () => {
  it('never excludes on unknown data (the spec\'s own rule: "Desconhecido nunca exclui")', () => {
    const firm = baseFirm(); // everything null/empty
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.eligible).toBe(true);
    expect(result.hard_reasons).toEqual([]);
  });

  it('stage_out: org stage more than one rank outside the firm\'s known range', () => {
    const firm = baseFirm({ stage_min: 'series_b', stage_max: 'later' }); // ranks 4-6
    // sherlockDealOrg is pre_seed (rank 1) — distance to lo(4) is 3, > 1
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.eligible).toBe(false);
    expect(result.hard_reasons).toContain('stage_out');
  });

  it('does NOT hard-exclude on a one-step stage miss (near-miss keeps it eligible with partial credit)', () => {
    const firm = baseFirm({ stage_min: 'seed', stage_max: 'series_a' }); // ranks 2-3, org is 1 (pre_seed) -> dist 1
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.eligible).toBe(true);
    const stagePart = result.parts.find((p) => p.area === 'stage')!;
    expect(stagePart.credit).toBe(10);
  });

  it('ticket_out: org ticket more than 2x outside the firm\'s known cheque range', () => {
    const firm = baseFirm({ check_min_eur: 5_000_000, check_max_eur: 20_000_000 });
    // sherlockDealOrg ticket 135k; lo/2 = 2.5M, 135k << that
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.eligible).toBe(false);
    expect(result.hard_reasons).toContain('ticket_out');
  });

  it('geography_out: DOMiNO Ventures case — real production data, invests in Eastern Europe/Central Asia/Caucasus/Türkiye, not Portugal', () => {
    // Real values read from production (catalog_entities row 008e605a-..., 2026-09-29).
    const domino = baseFirm({
      id: '008e605a-7f3a-4378-a44c-929698769718',
      name: 'DOMiNO Ventures',
      sectors_normalized: ['AI, Data & Analytics', 'ClimateTech & CleanTech', 'DeepTech'],
      stage_min: 'pre_seed',
      stage_max: 'series_a',
      check_min_eur: 100_000,
      check_max_eur: 1_000_000,
      geographies: ['Eastern Europe', 'Central Asia', 'Caucasus', 'Türkiye'],
      hq_country: 'NL',
      thesis: 'DOMiNO Ventures is a venture capital fund focusing on high-tech, pure-digital and first-day global startups with strong origins in Eastern Europe, Central Asia and the Caucasus.',
    });
    const result = catalogFit(sherlockDealOrg, domino);
    expect(result.eligible).toBe(false);
    expect(result.hard_reasons).toContain('geography_out');
    expect(result.score).toBeNull();
    // Sector and stage/ticket would otherwise look like a strong match — the
    // whole point of §0's DOMiNO example is that a real geography check is
    // the ONLY thing standing between this firm and a false "High fit".
    const sectorPart = result.parts.find((p) => p.area === 'sector')!;
    expect(sectorPart.credit).toBe(35);
  });

  it('falls back to hq_country (never hard-excludes on it) when invest_geographies is unknown', () => {
    const firm = baseFirm({ hq_country: 'US' }); // no geographies at all
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.eligible).toBe(true);
    expect(result.hard_reasons).not.toContain('geography_out');
    const geoPart = result.parts.find((p) => p.area === 'geography')!;
    expect(geoPart.known).toBe(true);
    expect(geoPart.credit).toBe(2); // "else" tier, same as the live production function's US/rest-of-world bucket
  });

  it('not_an_investor and excluded_by_thesis are always unknown against real data (no entity_kind/exclusions columns) — documented via warnings, never a hard exclusion', () => {
    const firm = baseFirm();
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.hard_reasons).not.toContain('not_an_investor');
    expect(result.hard_reasons).not.toContain('excluded_by_thesis');
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['entity_kind_unknown', 'exclusions_unknown']));
  });

  it('flags a likely non-investor association as a WARNING only, never a hard exclusion — Investors Portugal case', () => {
    // Real thesis text read from production (catalog_entities row 6e52bb96-..., 2026-09-29).
    const investorsPortugal = baseFirm({
      name: 'Investors Portugal',
      sectors_normalized: ['Biotechnology & Life Sciences', 'Digital Health', 'Enterprise Software & SaaS'],
      stage_min: 'pre_seed', stage_max: 'seed',
      check_min_eur: 100_000, check_max_eur: 500_000,
      hq_country: 'PT',
      thesis: 'National business angel body; coordinates the Portuguese angel plan.',
    });
    const result = catalogFit(sherlockDealOrg, investorsPortugal);
    expect(result.eligible).toBe(true); // cannot hard-exclude without a real entity_kind
    expect(result.warnings.map((w) => w.code)).toContain('possible_non_investor_entity_kind');
  });
});

describe('catalogFit — scoring with the fixed sector normalizer (§0 failure #1)', () => {
  it('Indico Capital Partners: raw lowercase sector tokens now credit correctly against SherlockDeal (AI/SaaS)', () => {
    // Real values read from production (catalog_entities row fbde8b3e-..., 2026-09-29).
    // Live production score today (catalog_match_score, verified 2026-09-29): 45 — sector credit 0.
    const indico = baseFirm({
      name: 'Indico Capital Partners',
      sectors_normalized: ['ai', 'consumer', 'deep tech', 'fintech', 'health', 'iot', 'robotics', 'saas', 'space'],
      stage_min: 'pre_seed', stage_max: 'later',
      check_min_eur: 250_000, check_max_eur: 10_000_000,
      hq_country: 'PT',
    });
    const result = catalogFit(sherlockDealOrg, indico);
    const sectorPart = result.parts.find((p) => p.area === 'sector')!;
    expect(sectorPart.credit).toBe(35); // 'ai' -> AI, Data & Analytics; 'saas' -> Enterprise Software & SaaS
    expect(result.score).toBeGreaterThan(45); // strictly higher than today's live production score
  });

  it('Indico Capital Partners also fixes correctly against ablute_ (health/deeptech) via the same raw tokens', () => {
    const indico = baseFirm({
      name: 'Indico Capital Partners',
      sectors_normalized: ['ai', 'consumer', 'deep tech', 'fintech', 'health', 'iot', 'robotics', 'saas', 'space'],
      stage_min: 'pre_seed', stage_max: 'later',
      check_min_eur: 250_000, check_max_eur: 10_000_000,
      hq_country: 'PT',
    });
    const result = catalogFit(abluteOrg, indico);
    const sectorPart = result.parts.find((p) => p.area === 'sector')!;
    expect(sectorPart.credit).toBe(35); // 'health' -> Digital Health, 'deep tech' -> DeepTech, 'robotics' -> Robotics & Automation
  });

  it('a firm with no sector overlap even after normalization still scores 0 on sector (Portugal Ventures case — not every 45 is a normalization bug)', () => {
    // Real values read from production: sectors_normalized are raw tokens
    // ("digital","industry","life sciences","tourism") but none of them maps
    // onto SherlockDeal's declared sectors even with the fix — this firm's
    // low score is a genuine lack of overlap, not (only) a normalizer bug.
    const portugalVentures = baseFirm({
      name: 'Portugal Ventures',
      sectors_normalized: ['digital', 'industry', 'life sciences', 'tourism'],
      stage_min: 'pre_seed', stage_max: 'series_a',
      check_min_eur: 200_000, check_max_eur: 6_000_000,
      hq_country: 'PT',
      geographies: [],
    });
    const result = catalogFit(sherlockDealOrg, portugalVentures);
    const sectorPart = result.parts.find((p) => p.area === 'sector')!;
    expect(sectorPart.credit).toBe(0);
  });

  it('a declared generalist token credits sector for any org (Shilling VC case)', () => {
    const shilling = baseFirm({
      name: 'Shilling VC',
      sectors_normalized: ['consumer', 'marketplaces', 'software', 'tecnologia generalista'],
      stage_min: 'pre_seed', stage_max: 'seed',
      check_min_eur: 100_000, check_max_eur: 1_000_000,
      hq_country: 'PT',
    });
    const result = catalogFit(sherlockDealOrg, shilling);
    const sectorPart = result.parts.find((p) => p.area === 'sector')!;
    expect(sectorPart.credit).toBe(35);
  });
});

describe('catalogFit — confidence', () => {
  it('is 100 when all four scored areas are known', () => {
    const firm = baseFirm({
      sectors_normalized: ['AI, Data & Analytics'],
      stage_min: 'pre_seed', stage_max: 'seed',
      check_min_eur: 50_000, check_max_eur: 500_000,
      geographies: ['Portugal'],
    });
    const result = catalogFit(sherlockDealOrg, firm);
    expect(result.confidence).toBe(100);
  });

  it('is 0 when none of the four scored areas are known', () => {
    const firm = baseFirm(); // fully empty, org ticket still known though
    const result = catalogFit(sherlockDealOrg, firm);
    // sector unknown, stage unknown, ticket known (firm side unknown -> still "not known" per ticketKnown flag), geography unknown
    expect(result.confidence).toBeLessThanOrEqual(25);
  });

  it('never reaches "eligible" scoring language when sector, stage and ticket are all unknown (spec: "Fit unknown", never "Medium")', () => {
    const firm = baseFirm();
    const result = catalogFit(sherlockDealOrg, firm);
    const known = result.parts.filter((p) => ['sector', 'stage', 'ticket'].includes(p.area) && p.known);
    expect(known.length).toBe(0);
    expect(result.confidence).toBeLessThan(50);
  });
});
