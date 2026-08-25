-- Prompt 382 §A — a persistent per-category visibility switch.
--
-- "Tag milestones so investors can filter your roadmap" has been sitting in
-- CategoryManager's own copy since Prompt 213 with nothing behind it. The
-- toggle lives on the category (not a client-side filter) because
-- RoadmapCanvas is the SAME component on both sides (RoadmapPanel for the
-- founder, DossierOverviewSections for the investor) — this is
-- roadmap_visible_to_investors's own pattern, one grain finer: the founder
-- decides, persistently, which categories are part of the roadmap at all.
--
-- Default true: on deploy, no existing category (the 5 seeded DEFAULT_LANES
-- or any custom one) changes visible state.
alter table public.roadmap_categories
  add column if not exists visible boolean not null default true;

-- RLS: the existing roadmap_categories_org_members policy is `for all using
-- (is_org_member(org_id))` — it already covers UPDATE, nothing new to write.
comment on column public.roadmap_categories.visible is
  'Prompt 382: founder-controlled, persistent. false hides this category''s '
  'lane AND its events from BOTH the founder canvas and the investor dossier '
  '(same shared RoadmapCanvas component) — never a client-side/session-only '
  'filter. The investor-facing type/projection never carries this column; '
  'dossier-fetch.ts filters at the query, fail-closed, same discipline as '
  'document_id.';
