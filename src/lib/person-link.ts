// Prompt 599 §2/§5 — ONE definition of "the same person" between a startup's
// private `people` row and a `catalog_people` row, shared by the per-row link
// proposal (/api/backoffice/people/[id]) and §5's batch gate. §5's dry-run
// and write ran the SQL equivalent of normalizePersonName (translate() over
// the same accent set + the same [^a-z0-9]+ collapse); this is the TypeScript
// side of that rule, pure so it is unit-tested and can never quietly drift
// between the two callers.
//
// Deliberately NOT catalog-dedupe's normalizeName: that one strips legal
// suffixes ("capital", "partners", "co", "group") that are right for firms
// and wrong for people — "Marco Co" and "Ana Partners" are names.
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface LinkCandidate {
  id: string;
  fullName: string;
  /** catalog_people.entity_id — the current/primary firm, or null (§3: a person survives without one). */
  entityId: string | null;
  /** Every catalog_person_affiliations.entity_id for this person, current or past. */
  affiliationEntityIds: string[];
}

export type LinkLayer = 1 | 2 | 3;

export interface LinkClassification {
  layer: LinkLayer;
  /** Same normalized name AND the private row's firm points (via entities.catalog_id) at this candidate's firm. */
  firmMatches: LinkCandidate[];
  /** Same normalized name, but the firm does not match — or there is no firm link to compare against. */
  others: LinkCandidate[];
}

export function candidateFirmMatches(candidate: LinkCandidate, firmCatalogId: string | null): boolean {
  if (!firmCatalogId) return false;
  return candidate.entityId === firmCatalogId || candidate.affiliationEntityIds.includes(firmCatalogId);
}

/**
 * §5's three layers, applied to ONE private row whose same-name candidates
 * have already been found.
 *
 * Layer 1 — safe to write: exactly one same-name candidate exists at all, and
 *   the private row's firm points at that candidate's firm. "Exactly one" is
 *   read strictly (one candidate overall, not one firm-match among several):
 *   the more conservative of the two readings, and on production on
 *   2026-09-07 the relaxed reading would have added zero rows anyway.
 * Layer 2 — a person decides: same name, but the firm doesn't match, there is
 *   no firm link to compare, or more than one candidate.
 * Layer 3 — count only: no same-name candidate in the catalog.
 */
export function classifyLinkCandidates(sameNameCandidates: LinkCandidate[], firmCatalogId: string | null): LinkClassification {
  const firmMatches = sameNameCandidates.filter((c) => candidateFirmMatches(c, firmCatalogId));
  const others = sameNameCandidates.filter((c) => !candidateFirmMatches(c, firmCatalogId));
  if (sameNameCandidates.length === 0) return { layer: 3, firmMatches, others };
  if (sameNameCandidates.length === 1 && firmMatches.length === 1) return { layer: 1, firmMatches, others };
  return { layer: 2, firmMatches, others };
}
