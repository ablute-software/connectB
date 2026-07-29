-- Onboarding & progressive-teaching system (onboarding_sherlockdeal_v2.md),
-- Phase 1. One row per user, jsonb `seen` rather than one row per item —
-- few keys, read once at session start, and a new onboarding key never
-- needs a migration to add.
create table onboarding_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  seen          jsonb not null default '{}'::jsonb,  -- { "welcome": "2026-07-28T10:00:00Z", ... }
  opted_out     boolean not null default false,
  last_shown_at timestamptz
);

alter table onboarding_state enable row level security;
create policy onboarding_state_own on onboarding_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
