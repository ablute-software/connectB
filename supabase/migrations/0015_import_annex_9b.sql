-- IRM_SPEC §9b (import annex) — columns the real files carry that the
-- generic §9 schema didn't need. Purely additive: new nullable columns
-- (or safe defaults), no RLS changes, existing policies already cover the
-- whole table.

-- entities.csv's hardware_stance is called out as "the most important
-- column in this file" (screen on it before fit_score); is_sector_agnostic
-- flags generalist vs specialist funds; last_verified/source_url are the
-- provenance pair the CSV itself carries per row (re-verify >90 days).
alter table entities add column if not exists hardware_stance text;
alter table entities add column if not exists is_sector_agnostic boolean;
alter table entities add column if not exists last_verified timestamptz;
alter table entities add column if not exists source_url text;

-- §9b-4 — extend person_affiliations (0009) rather than create a parallel
-- table. seniority_rank/is_primary let approach order live per-affiliation
-- (e.g. Lurdes Gramaxo: Bynd is her base entity_id, but the affiliation
-- that should actually drive outreach is Investors Portugal, is_primary).
alter table person_affiliations add column if not exists seniority_rank int;
alter table person_affiliations add column if not exists is_primary boolean not null default false;
alter table person_affiliations add column if not exists notes text;
