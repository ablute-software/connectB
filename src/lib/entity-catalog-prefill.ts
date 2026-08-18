// Prompt 256 §B — an entity auto-created from a platform interest event
// (e.g. "Invest green" expressing interest in a pack) starts with an empty
// Entity summary, even though the investor's own MatchDeal profile
// (catalog_entities) already has sectors/stage/check/thesis on file. The
// data exists; it just never flowed across. This resolves the CRM entity to
// its catalog_entities row and computes which currently-empty fields that
// row can fill.
//
// Resolution reuses the exact domain-first/name-fallback primitives
// deal-messages.ts's resolveFounderEntityToEligibleFirm already uses
// (normalizeDomain/normalizeName from catalog-dedupe.ts, domainMatchesEntity
// from investor-domain-match.ts) — not reimplemented. That function itself
// isn't reused directly because it's scoped to catalog rows with a recorded
// 'interested' decision (the founder-message eligibility question); prefill
// has to work the moment the entity is created, before any decision exists,
// so it matches against the whole catalog instead. Name-fallback requires an
// EXACT, UNIQUE normalized match (mirrors resolveClaimedEntity in
// investor-domain-match.ts) — an ambiguous name match would risk showing one
// firm's thesis on another firm's dossier, which is worse than showing none.
import { normalizeDomain, normalizeName } from './catalog-dedupe';
import { domainMatchesEntity } from './investor-domain-match';
import type { CatalogEntity, Entity, Stage } from './types';

export function matchEntityToCatalog(
  entity: { name: string; website?: string | null },
  catalog: CatalogEntity[],
): CatalogEntity | null {
  const entityDomain = normalizeDomain(entity.website ?? null);
  if (entityDomain) {
    const byDomain = catalog.find((c) => {
      const catalogDomain = normalizeDomain(c.website ?? null);
      return !!catalogDomain && domainMatchesEntity(entityDomain, catalogDomain);
    });
    if (byDomain) return byDomain;
  }
  const entityName = normalizeName(entity.name);
  if (!entityName) return null;
  const byName = catalog.filter((c) => normalizeName(c.name) === entityName);
  return byName.length === 1 ? byName[0] : null;
}

export interface EntitySummaryPrefill {
  website?: string;
  hqCity?: string;
  hqCountry?: string;
  sectors?: string[];
  stageMin?: Stage;
  stageMax?: Stage;
  checkMinEur?: number;
  checkMaxEur?: number;
  thesis?: string;
}

// Field list matches the one already-established founder-facing precedent
// (unlockPack in store-supabase.tsx / deliverMonthlyForOrg in
// catalog-monthly-delivery-server.ts both copy exactly this set from
// catalog_entities into a founder's entities row) — nothing here is newly
// exposed to founders that wasn't already. Deliberately excludes
// `geographies`: both existing copy paths skip it too, and `notes`/contact/
// moderation/enrichment columns, which are never founder-facing.
//
// Compound fields (HQ, stage range, check range) are filled as a unit: only
// when EVERY constituent entity field is empty, and only if the catalog has
// at least one of them — a half-founder/half-platform HQ or stage range
// would need per-field badges to stay honest, which is more UI than the
// value is worth.
export function computeEntitySummaryPrefill(entity: Entity, catalogMatch: CatalogEntity | null): EntitySummaryPrefill {
  if (!catalogMatch) return {};
  const out: EntitySummaryPrefill = {};

  if (!entity.website && catalogMatch.website) out.website = catalogMatch.website;

  if (!entity.hq_city && !entity.hq_country && (catalogMatch.hq_city || catalogMatch.hq_country)) {
    out.hqCity = catalogMatch.hq_city;
    out.hqCountry = catalogMatch.hq_country;
  }

  if (entity.sectors.length === 0 && catalogMatch.sectors.length > 0) out.sectors = catalogMatch.sectors;

  if (!entity.stage_min && !entity.stage_max && (catalogMatch.stage_min || catalogMatch.stage_max)) {
    out.stageMin = catalogMatch.stage_min;
    out.stageMax = catalogMatch.stage_max;
  }

  if (entity.check_min_eur == null && entity.check_max_eur == null
    && (catalogMatch.check_min_eur != null || catalogMatch.check_max_eur != null)) {
    out.checkMinEur = catalogMatch.check_min_eur;
    out.checkMaxEur = catalogMatch.check_max_eur;
  }

  if (!entity.thesis && catalogMatch.thesis) out.thesis = catalogMatch.thesis;

  return out;
}
