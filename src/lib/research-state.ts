// Prompt 737 §0B.1 — the dossier's own two-value research state: either
// the platform has run enrichment on this person or it hasn't, never a
// third state. `catalog_people.enriched_at` is the spec's literal date
// source, but it is almost never populated in practice — confirmed
// against production 2026-09-25/26: 1,736 people are
// enrichment_status='enriched', and only 40 of them have enriched_at set.
// Nuno's decision: fall back to catalog_people_research.updated_at, and
// say "last updated" rather than "researched on" — that second timestamp
// also moves on a plain backoffice edit, not only on a real enrichment
// run, so the label must not claim more precision than it has.
export function researchStateLabel(
  enrichmentStatus: string | null | undefined,
  enrichedAt: string | null | undefined,
  researchUpdatedAt: string | null | undefined,
): string {
  if (enrichmentStatus !== 'enriched') return 'Not yet researched by the platform';
  const date = enrichedAt ?? researchUpdatedAt;
  return date ? `Researched by the platform · last updated ${date.slice(0, 10)}` : 'Researched by the platform';
}
