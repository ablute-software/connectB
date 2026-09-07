-- Prompt 580 §B.1 — "Not duplicates" persists a decision instead of the
-- tool re-proposing the same false-positive group forever. Keyed by an
-- ORDERED pair of catalog_entities ids — the atomic unit catalog-dedupe.ts
-- actually reasons about (DupMatch): a cluster can have any number of
-- members, but it is really a set of pairwise edges chained together by
-- union-find, and "not duplicates" has to say which PAIR was wrong, not
-- freeze one specific N-member shape that a later, genuinely different
-- match would never reproduce anyway.
--
-- a_catalog_id < b_catalog_id is enforced so the same pair is never stored
-- twice in two orders — the route always canonicalizes with
-- least()/greatest() before writing or reading.
create table if not exists catalog_dedupe_dismissals (
  id uuid primary key default gen_random_uuid(),
  a_catalog_id uuid not null references catalog_entities(id) on delete cascade,
  b_catalog_id uuid not null references catalog_entities(id) on delete cascade,
  reason text not null,
  dismissed_by uuid references auth.users(id),
  dismissed_at timestamptz not null default now(),
  constraint catalog_dedupe_dismissals_ordered check (a_catalog_id < b_catalog_id),
  unique (a_catalog_id, b_catalog_id)
);

alter table catalog_dedupe_dismissals enable row level security;
create policy catalog_dedupe_dismissals_admin on catalog_dedupe_dismissals for all
  using (is_platform_admin()) with check (is_platform_admin());
