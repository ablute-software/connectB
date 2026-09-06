-- Prompt 581 §C.5 — the dossier's manual-research links need to know
-- whether a firm's website has a /team, /about or /people page that
-- actually responds (checked server-side, per the prompt's own wording,
-- so a dossier page load never becomes a client-side call to a random
-- third-party site). Cached on the entity — the check result is shared by
-- every person at that firm, not per-person — so N people at the same
-- firm don't each trigger their own outbound check.
alter table public.catalog_entities
  add column if not exists team_page_url text,
  add column if not exists team_page_checked_at timestamptz;

comment on column public.catalog_entities.team_page_url is
  'The first of website+"/team", +"/about", +"/people" that responded 200 when last checked, or null if none did (or website is unset). Re-checked when team_page_checked_at is null or stale — see the dossier route for the TTL.';
