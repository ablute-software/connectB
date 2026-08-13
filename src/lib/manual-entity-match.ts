// Prompt 187 §A — "does this founder-added entities row already exist in
// catalog_entities?" Pure, I/O-free (mirrors catalog-dedupe.ts's own
// no-I/O convention), reusing that file's normalizeName/normalizeDomain
// EXACTLY (not a second implementation) — the prompt's own instruction is
// "mesmo critério do MergeDuplicatesTool". Deliberately a plain one-to-many
// lookup, not catalog-dedupe.ts's union-find clustering: this never merges
// two catalog_entities rows with each other, it only asks "does ONE manual
// row match anything already in the catalog", so the graph-clustering
// machinery built for the other problem doesn't fit and isn't reused.
import { normalizeDomain, normalizeName, type Alias, type CatalogRow } from './catalog-dedupe';

export type ManualMatchReason = 'domain' | 'name' | 'alias';

export interface ManualMatch {
  catalogId: string;
  reason: ManualMatchReason;
}

/**
 * The first (domain beats name beats alias, matching the priority a human
 * reviewer would trust most) catalog_entities row this manual entity looks
 * like a duplicate of, or null if nothing matches.
 */
export function findLikelyCatalogMatch(
  manual: { name: string; website: string | null },
  catalogRows: CatalogRow[], aliases: Alias[],
): ManualMatch | null {
  const manualDomain = normalizeDomain(manual.website);
  if (manualDomain) {
    const byDomain = catalogRows.find((c) => normalizeDomain(c.website) === manualDomain);
    if (byDomain) return { catalogId: byDomain.id, reason: 'domain' };
  }

  const manualName = normalizeName(manual.name);
  if (manualName) {
    const byName = catalogRows.find((c) => normalizeName(c.name) === manualName);
    if (byName) return { catalogId: byName.id, reason: 'name' };

    const byAlias = aliases.find((a) => normalizeName(a.alias) === manualName);
    if (byAlias) return { catalogId: byAlias.catalog_id, reason: 'alias' };
  }

  return null;
}
