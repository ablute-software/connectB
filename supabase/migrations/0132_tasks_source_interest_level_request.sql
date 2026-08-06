-- P136 §7 — the founder's Today gets a real task the moment an investor
-- requests level 3 (named-contact messaging + data-room request), same
-- persistent-signal pattern as 'investor_interest' (0128). A distinct
-- source value (not reused from 'investor_interest') so the two kinds of
-- task can be told apart and auto-closed independently later — 0128's own
-- header already made the case for why a shared/ambiguous value costs
-- more than the one extra line a new value takes.
alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source is null or source = any (array['suggested', 'manual', 'investor_interest', 'interest_level_request']));
