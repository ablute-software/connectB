-- Prompt 742 §A.1 — "requires NDA by default" as a property of the
-- DOCUMENT, not only of the grant (access_grants.nda_required) or an
-- implicit consequence of visibility='due_diligence'. No backfill: a
-- due_diligence document already requires NDA via that existing rule
-- (requiresNda() in data-room.ts checks both), so every existing row
-- correctly defaults to false here without changing any existing
-- document's real NDA requirement.
alter table documents add column if not exists nda_by_default boolean not null default false;
