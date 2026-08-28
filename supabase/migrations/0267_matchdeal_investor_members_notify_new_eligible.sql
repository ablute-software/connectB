-- Prompt 421 §D.2 — the one real automation this wave: notify when a new
-- startup enters this investor's eligible pipeline. Lives on
-- matchdeal_investor_members (per-member, not per-firm — colleagues can
-- have different notification preferences even at the same firm) rather
-- than a new table, same "small boolean, no new infra" posture as
-- onboarding_state.evaluation_tools_intro_muted (migration 0265). Writes
-- to this table are admin-route-only (0053's own matchdeal_investor_
-- members_select_own policy is SELECT-only, deliberately — status/role
-- are security-sensitive) — this column follows the same rule, no new RLS
-- policy added here, just the column.
alter table public.matchdeal_investor_members
  add column if not exists notify_new_eligible_startup boolean not null default false;
