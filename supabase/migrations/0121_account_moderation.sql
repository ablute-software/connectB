-- Prompt 123 Block C.2 — account moderation (suspend/undo/delete/quarantine)
-- for both Startups (orgs) and Investors (catalog_entities — the firm-level
-- account; matchdeal_investor_members are its seats, same shape as
-- org_members). PROPOSE ONLY — not applied.
--
-- Deliberately separate from matchdeal_profiles.owner_suspended_at /
-- platform_suspended_at (migration 0105): those are cosmetic, MatchDeal-deck-
-- only toggles already wired into matchdeal_recompute_profile_completeness()
-- and catalog_is_visible() — they do NOT block login and do NOT hide an
-- account from backoffice metrics (confirmed by reading both call sites).
-- Reusing them for real account moderation would silently change what that
-- existing trigger means. This migration adds NEW columns instead.
--
-- Soft delete only, per the doc's own instruction: `moderation_status`
-- becomes 'deleted', nothing is DROPped. Anonymization of a deleted
-- account's data is deliberately NOT in this migration — grants/documents
-- retention needs its own decision before any anonymization job is
-- written; flagged, not invented here.

do $$ begin
  create type public.moderation_status as enum ('active', 'suspended', 'deleted');
exception when duplicate_object then null; end $$;

alter table public.orgs
  add column if not exists moderation_status public.moderation_status not null default 'active',
  add column if not exists moderation_quarantine_until timestamptz;

alter table public.catalog_entities
  add column if not exists moderation_status public.moderation_status not null default 'active',
  add column if not exists moderation_quarantine_until timestamptz;

create table if not exists public.account_moderation_actions (
  id uuid primary key default uuid_generate_v4(),
  target_type text not null check (target_type in ('org', 'investor')),
  target_id uuid not null,
  action text not null check (action in ('suspend', 'undo', 'delete')),
  justification text not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  quarantine_until timestamptz
);
create index if not exists account_moderation_actions_target_idx
  on public.account_moderation_actions (target_type, target_id, created_at desc);

alter table public.account_moderation_actions enable row level security;
create policy account_moderation_actions_developer_read on public.account_moderation_actions
  for select using (public.is_ablute_developer());
-- Writes go through service-role backoffice API routes only (requirePlatformAdmin()
-- already gates every /api/backoffice/* route) — no insert/update/delete policy
-- needed for any authenticated role.

-- Server-side login gate (§C.2: must not be UI-only). Additive: checks the
-- signed-in user's org membership (orgs.moderation_status) OR their active
-- matchdeal_investor_members row's catalog_entities.moderation_status.
-- Never touches access_grants — that system is untouched by this migration.
create or replace function public.is_account_suspended()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.org_members om
       join public.orgs o on o.id = om.org_id
      where om.user_id = auth.uid() and o.moderation_status <> 'active'
      limit 1),
    (select true from public.matchdeal_investor_members mim
       join public.catalog_entities ce on ce.id = mim.catalog_entity_id
      where mim.user_id = auth.uid() and mim.status = 'active' and ce.moderation_status <> 'active'
      limit 1),
    false
  );
$$;
grant execute on function public.is_account_suspended() to authenticated;
