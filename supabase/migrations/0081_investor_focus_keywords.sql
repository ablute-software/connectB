-- Prompt 80 addenda (Exclusions revisit) — a NEW, separate concept from
-- exclusions_sectors/exclusions_notes: free-text mandate-focus keywords
-- ("health", "agriculture", "fintech B2B"), not tied to the closed
-- sectors taxonomy. Nuno's own example (agriculture investor -> drones
-- startup makes less sense) describes a MATCHING rule, not a form field —
-- this column only stores/displays the keywords. Never read by the match-
-- score function or any scoring path; wiring it into matching is a
-- separate, explicitly-deferred product decision (see PipelinePanel /
-- investor-pipeline.ts, untouched by this migration).
alter table matchdeal_profiles
  add column if not exists focus_keywords text[] not null default '{}';
