-- Prompt 447 §B — org_competitors.relation (direct/indirect/adjacent) is a
-- coarser classification than the 6 web-research competitor types (445).
-- Rather than force-fit and lose information, this stores the finer
-- classification alongside relation (which stays, unchanged, for the
-- existing UI that already reads it).
alter table org_competitors add column if not exists competitor_type text
  check (competitor_type in ('direct', 'functional', 'budget', 'status_quo', 'emerging', 'potential_entrant'));

comment on column org_competitors.competitor_type is
  'Prompt 447 §B — the 445 classification (finer than relation), when the source is a web research item with competitorType. Null for manually-added competitors or ones sourced from a document (no such field there).';
