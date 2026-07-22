-- Real history import: ~380 of ~494 historical interactions have no color
-- marking, and the source file's own header warns green (positive) never
-- survived the export — absence of color is NOT absence of interest. That's
-- too many items to force a one-time staging review; persisting the flag
-- lets the founder review over time via the normal entity/person screens
-- instead of a single blocking gate.
alter table interactions add column if not exists needs_review boolean not null default false;
create index on interactions (org_id, needs_review) where needs_review;
