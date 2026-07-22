-- IRM_SPEC §8e — track which interactions were AI-drafted (composer), vs
-- manually written. Metadata only: never changes send/logging behaviour,
-- just tags the row for the thread UI and future analytics.

alter table interactions add column if not exists ai_generated boolean not null default false;

create index on interactions (org_id, ai_generated);
