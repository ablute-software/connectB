// Prompt 281 §1 — sector-fit gate for the enrichment campaign's candidate
// selection. Research done before writing this (full findings in the
// commit message): catalog_entities.sectors/thesis are FREE TEXT (351
// distinct raw values in production — 'healthtech', 'biotech', 'deep tech',
// lowercase, inconsistent), never validated against any taxonomy anywhere
// in the write path (the AI worker's own tool schema has no enum on
// `sectors`). orgs.sectors is the OPPOSITE: a closed, canonical taxonomy
// (sector-taxonomy.ts's SECTOR_TAXONOMY / ALL_SECTOR_NAMES). A migration
// (0148) already bridged this gap once — catalog_entities.sectors_normalized
// — but it was a ONE-TIME, manually-reviewed SQL backfill (2026-08-08); the
// enrichment worker never writes to it, so every entity enriched since then
// (GapMinder included) has it null. Reusing sectors_normalized alone would
// silently misjudge every recently-enriched row as "no fit" — not because
// it lacks fit, but because nothing ever populated the column.
//
// Reuse considered and rejected: sector-exclusions.ts's normalizeSectorTerms/
// termsCollide (word-boundary + squash equality) is this repo's one existing
// free-text-safe comparator, and the closest reuse candidate — but it's
// built to avoid short-stem false positives across the FULL ~50-sector
// taxonomy (so "tech" alone must never match "agritech"), which means it
// requires an exact shared WORD. That's precisely what breaks on the real
// data here: "healthtech" and "biotech" don't share a literal word with any
// canonical Health & Life Sciences name ("Digital Health", "Biotechnology &
// Life Sciences", ...) — migration 0148's own manually-curated ~250-row
// lookup table is what bridges compound free-text words to canonical
// categories, and reimplementing that table's judgment calls inline here
// would be duplicating real curation work, not reuse.
//
// What this file does instead — deliberately narrow, not a general
// taxonomy normalizer: a small, explicit keyword list for the ONE category
// that's actually relevant today (ablute_ is the only real org with
// deliveries, and it's healthtech — confirmed via catalog_deliveries
// research). Plain substring matching, not word-boundary: the whole point
// is to catch compound words like "healthtech".includes("health") that a
// word-boundary matcher would miss. Safe here because every keyword below
// is long/specific enough to not false-positive on unrelated text (unlike
// short ambiguous stems such as "ai" or "tech", which is exactly why
// sector-exclusions.ts doesn't do plain substring matching for the general
// case). If a second real org with deliveries in a different category ever
// exists, this needs a second keyword set gated the same way — not a
// generic engine built now for a need that doesn't exist yet.
import { SECTOR_TAXONOMY } from './sector-taxonomy';

const HEALTH_CATEGORY_SECTORS = new Set(
  SECTOR_TAXONOMY.find((c) => c.name === 'Health & Life Sciences')?.sectors ?? [],
);

// Compound-word-safe stems for Health & Life Sciences, covering both the
// canonical taxonomy names (lowercased) and the common free-text variants
// seen in real catalog_entities.sectors data ('healthtech', 'biotech',
// 'medtech' — none of which literally contain a canonical taxonomy word).
const HEALTH_FIT_KEYWORDS = [
  'health', 'medtech', 'medical device', 'biotech', 'pharma', 'therapeutic',
  'drug discovery', 'diagnostic', 'genomic', 'precision medicine',
  'synthetic biology', 'femhealth', 'fem health', 'longevity', 'agetech',
  'clinical research', 'life science',
];

// Prompt 281 §1 — "generalistas explícitos" pass regardless of category.
const GENERALIST_KEYWORDS = [
  'generalist', 'sector-agnostic', 'sector agnostic', 'across sectors',
  'all sectors', 'any sector', 'multi-sector', 'multi sector', 'sector-neutral',
];

// 'fit' — free text matched a relevant keyword (or explicit generalist).
// 'low_fit' — delivered to an org whose sectors we CAN judge against, but no
//   match found: genuinely deprioritized, never blocked.
// 'not_applicable' — no basis to judge at all (never delivered anywhere, or
//   delivered only to org(s) outside the one category this file covers) —
//   deliberately NOT the same as 'low_fit': we don't claim "no fit" for a
//   category we have no keyword coverage for.
export type SectorFitResult = 'fit' | 'low_fit' | 'not_applicable';

export function catalogEntitySectorFit(
  freeTextSectors: string[] | null | undefined,
  freeTextThesis: string | null | undefined,
  deliveredOrgsSectors: string[][],
): SectorFitResult {
  if (deliveredOrgsSectors.length === 0) return 'not_applicable';
  const haystack = [...(freeTextSectors ?? []), freeTextThesis ?? ''].join(' ').toLowerCase();
  if (GENERALIST_KEYWORDS.some((k) => haystack.includes(k))) return 'fit';
  const needsHealthFit = deliveredOrgsSectors.some((orgSectors) => orgSectors.some((s) => HEALTH_CATEGORY_SECTORS.has(s)));
  if (!needsHealthFit) return 'not_applicable';
  return HEALTH_FIT_KEYWORDS.some((k) => haystack.includes(k)) ? 'fit' : 'low_fit';
}
