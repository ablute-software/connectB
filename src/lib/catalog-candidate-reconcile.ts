// Prompt 570 §D.3 — deciding which hand-added entities are already in the
// catalog, so the review queue stops asking about them.
//
// The queue said "Added by startups (751)". Measured: 692 of those 751 share a
// normalized domain with a catalog row and 57 more share a normalized name.
// Four out of five items in the queue were asking a reviewer to look at
// something the catalog already knows.
//
// The normalizers are catalog-dedupe.ts's, not new ones. MergeDuplicatesTool
// and the manual-entities listing already use them, and its own header says
// why: a second matching algorithm means two answers to "is this the same
// firm", and the queue and the merge tool disagreeing is worse than either
// being imperfect. LEGAL_SUFFIXES there already strips capital/ventures/
// partners/vc/fund — the exact list this prompt asked for, plus a few more.
import { normalizeName, normalizeDomain } from './catalog-dedupe';

/** Statuses a human has already decided. Reconciliation never touches them. */
export const DECIDED_STATUSES = ['merged', 'promoted', 'dismissed'] as const;

export interface ReconcileCandidate {
  id: string;
  name: string;
  website: string | null;
  catalog_review_status: string | null;
  /**
   * The catalog row this entity was delivered from, if any. 749 of the 751
   * candidates have exactly one — see 0316's header for why that link is read
   * here but never written: catalog_deliveries is an event, and a
   * reconciliation job must not be able to hand someone an investor.
   */
  deliveredCatalogId?: string | null;
}

export interface ReconcileCatalogRow {
  id: string;
  name: string;
  website: string | null;
}

export type ReconcileStatus = 'linked' | 'probable_match' | 'pending';

export interface ReconcileDecision {
  id: string;
  status: ReconcileStatus;
  catalogId: string | null;
  /** Why, so the report and the UI can say it rather than assert a match. */
  basis: 'domain' | 'name' | 'delivery' | 'none';
}

/**
 * Pure: candidates + catalog in, decisions out. No I/O, so the rules are
 * testable without a database and the route stays a thin caller.
 *
 * Rows a human already decided are returned untouched — the caller must not
 * write them. That is the §D.7 suspicion made structural rather than trusted:
 * if dismissed rows kept reappearing, it was because something recomputed the
 * list without reading catalog_review_status.
 */
export function reconcileCandidates(
  candidates: ReconcileCandidate[],
  catalog: ReconcileCatalogRow[],
): ReconcileDecision[] {
  // Deterministic pick when several catalog rows share a key: the same input
  // must always produce the same output, or "idempotent" is not true.
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of [...catalog].sort((a, b) => a.id.localeCompare(b.id))) {
    const domain = normalizeDomain(row.website);
    if (domain && !byDomain.has(domain)) byDomain.set(domain, row.id);
    const name = normalizeName(row.name);
    if (name && !byName.has(name)) byName.set(name, row.id);
  }

  const out: ReconcileDecision[] = [];
  for (const c of candidates) {
    if (DECIDED_STATUSES.includes((c.catalog_review_status ?? '') as never)) continue;

    const domain = normalizeDomain(c.website);
    const domainHit = domain ? byDomain.get(domain) : undefined;
    if (domainHit) {
      out.push({ id: c.id, status: 'linked', catalogId: domainHit, basis: 'domain' });
      continue;
    }

    // Same name, different or missing domain. Not an automatic link: b2venture
    // (b2venture.vc) and btov Partners (btov.vc) are one firm after a rename,
    // and Adventure - ADV is not Adventure Capital. A human decides, but
    // between two named things rather than a blank review.
    const name = normalizeName(c.name);
    const nameHit = name ? byName.get(name) : undefined;
    if (nameHit) {
      out.push({ id: c.id, status: 'probable_match', catalogId: nameHit, basis: 'name' });
      continue;
    }

    // Neither rule matched, but this row was DELIVERED from a catalog row —
    // which is a stronger statement than either: the platform itself put that
    // firm in front of this founder. Earlybird Venture Capital arriving as
    // "Earlybird Health strategy" is the shape: renamed by hand after
    // delivery, so name and domain both drift, and the link survives anyway.
    //
    // probable_match rather than linked, deliberately: a delivery says where
    // the row came from, not that the founder did not then edit it into
    // something else. It is exactly the "two named things, human decides"
    // case, so it belongs in the queue rather than out of it.
    //
    // This also makes the queue's merge-vs-promote contract exact:
    // probable_match always carries a catalog row to merge into, pending never
    // does. Before this, a pending row could carry a delivery-derived id and
    // the bulk action would have merged on a correspondence the rules had just
    // declined to make.
    if (c.deliveredCatalogId) {
      out.push({ id: c.id, status: 'probable_match', catalogId: c.deliveredCatalogId, basis: 'delivery' });
      continue;
    }

    out.push({ id: c.id, status: 'pending', catalogId: null, basis: 'none' });
  }
  return out;
}

/** Counts by status, for the before/after report the prompt asks for. */
export function summarize(decisions: ReconcileDecision[]): Record<ReconcileStatus, number> {
  return decisions.reduce((acc, d) => { acc[d.status] += 1; return acc; },
    { linked: 0, probable_match: 0, pending: 0 } as Record<ReconcileStatus, number>);
}
