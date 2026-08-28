-- Prompt 420 §B.3 — "Tell Watson I don't want to read this anymore",
-- the mute checkbox on the Evaluation Tools intro pamphlet. Same table
-- and RLS as every other onboarding_state column (0043's own
-- onboarding_state_own policy is already `for all`, so a new column
-- needs no new policy) — the "first time per login" part of this
-- feature stays in-memory only (a module-level flag in
-- EvaluationToolsPanel.tsx), never written here; this column exists
-- ONLY for the durable opt-out.
alter table public.onboarding_state
  add column if not exists evaluation_tools_intro_muted boolean not null default false;
