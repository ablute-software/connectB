// Batch 2 item 3 — cross-org existence signal for unverified quick-created
// people. Founder decision: an unverified person stays PRIVATE to their own
// org UNLESS enough distinct orgs report a similar person, in which case
// only an AGGREGATE signal (counts + proposed fields, no org identities, no
// interaction content) surfaces to back-office for an existence review —
// same privacy discipline as Startups/Métricas. With today's single-org
// reality this can never actually fire; that's the correct behavior, not a
// bug — it's a real threshold, not a soft heuristic that happens to be low.
import { normalizeName } from './catalog-dedupe';

// Configurable, per the founder's own instruction — not a guess.
export const CROSS_ORG_REPORT_THRESHOLD = 10;
export const FIELD_SIMILARITY_THRESHOLD = 0.8;

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// Sørensen–Dice coefficient over character bigrams of the normalized name —
// simple, symmetric, forgiving of small typos/OCR noise without needing a
// full edit-distance implementation.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

export interface UnverifiedPersonReport {
  orgId: string;
  personId: string;
  fullName: string;
  // Entity name (or email domain) — the "who they work for" signal that
  // keeps two different real people who happen to share a name from being
  // clustered together just because the names match.
  context: string;
}

export interface ExistenceCluster {
  reportOrgIds: Set<string>;
  personIds: string[];
  sampleFullName: string;
  sampleContext: string;
}

// Greedy single-pass clustering (not a full union-find like
// catalog-dedupe's findDuplicateClusters) — appropriate here because the
// match test itself is a similarity threshold, not an equality key, so
// there's no natural hash-map bucket to union across; a report only ever
// joins the first cluster it plausibly matches.
export function clusterUnverifiedReports(
  reports: UnverifiedPersonReport[],
  nameThreshold: number = FIELD_SIMILARITY_THRESHOLD,
): ExistenceCluster[] {
  const clusters: ExistenceCluster[] = [];
  for (const report of reports) {
    const normContext = normalizeName(report.context);
    const match = clusters.find((c) =>
      normalizeName(c.sampleContext) === normContext && nameSimilarity(c.sampleFullName, report.fullName) >= nameThreshold);
    if (match) {
      match.reportOrgIds.add(report.orgId);
      match.personIds.push(report.personId);
    } else {
      clusters.push({
        reportOrgIds: new Set([report.orgId]), personIds: [report.personId],
        sampleFullName: report.fullName, sampleContext: report.context,
      });
    }
  }
  return clusters;
}

export function shouldSurfaceCluster(cluster: ExistenceCluster, threshold: number = CROSS_ORG_REPORT_THRESHOLD): boolean {
  return cluster.reportOrgIds.size >= threshold;
}
