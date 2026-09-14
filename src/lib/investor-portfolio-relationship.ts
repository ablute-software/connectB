// Prompt 683 — a startup whose founder has already recorded THIS investor
// as `invested` in their own pipeline (entities.status, linked to the
// investor's catalog_entity_id via catalog_deliveries — the same
// resolution the interest-level request task already uses to find "the
// founder's own CRM entity for this investor") must never appear to that
// investor as a discovery card with a match score. It already happened;
// there is nothing left to discover. Pure predicate, same pattern as
// investor-pipeline-stage.ts: the caller resolves the entity row(s) for an
// org+investor pair, this only decides what they mean.
//
// An array, not a single status, because nothing stops a founder from
// having more than one `entities` row pointing at the same catalog investor
// over time (e.g. after a merge/re-import) — ANY of them reading 'invested'
// is enough; this never assumes there's exactly one.
export function hasPortfolioRelationship(entityStatuses: (string | null | undefined)[]): boolean {
  return entityStatuses.some((s) => s === 'invested');
}
