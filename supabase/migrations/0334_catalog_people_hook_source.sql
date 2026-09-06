-- Prompt 583 §B — tracks which path produced a person's hook: 'bio' (the
-- cheap, no-web path over an existing bio_raw, ~€0.005) or 'web' (the
-- fallback that searches and reads sources, only reached when the bio
-- path has no bio or found nothing confident enough). Observability for
-- the cost/quality tradeoff the prompt asks to measure, not used by any
-- read path today.
alter table public.catalog_people_research
  add column if not exists hook_source text check (hook_source is null or hook_source in ('bio', 'web'));
