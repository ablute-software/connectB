-- Prompt 407 §B.4 — provenance marker: was this entity's researched data
-- overridden by a claimed, complete investor profile at the moment it was
-- delivered into the founder's pipeline (catalog-monthly-delivery-server.ts's
-- deliverMonthlyForOrg). A point-in-time snapshot of that ONE event, not a
-- live "is this entity currently claimed" status — named accordingly, so a
-- later claim revocation is never misread as this flag having gone stale.
alter table entities add column if not exists claimed_profile_at_delivery boolean not null default false;
