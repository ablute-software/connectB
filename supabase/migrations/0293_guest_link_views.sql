-- Prompt 526 Part C — who opened a guest link, and from how many places.
--
-- NUMBERING: renumbered 0292 -> 0293 by Prompt 535, when this branch was
-- reconciled with claude/sherlockdeal-git-access-bek6d7. That branch took BOTH
-- 0291 (network_moderation_lifecycle) and 0292 (access_grants_allow_invited_email)
-- and applied them to production before this one landed, so the numbers this
-- file originally reserved were already gone.
--
-- The ordering debt that motivated the original note still stands, one number
-- further along: renaming supabase/migrations/0289_contribute_catalog_person.sql
-- (branch claude/prompt-512-contribute-people) now becomes 0295, so it replays
-- AFTER 0289_founder_person_contributions.sql, which creates the
-- contribution_points table it writes to. Getting that backwards breaks only a
-- fresh replay, never production. 0294 is Round Blueprint
-- (claude/prompt-534-round-blueprint) and is unchanged.
--
-- WHY NOT document_views. That table exists and is the right home for "this
-- person opened this document", but document_id is NOT NULL: opening a guest
-- LINK is not a document view, and there is no document to name. Reusing it
-- would mean either weakening its constraint or inventing a fake document id.
-- This is a separate, smaller fact about a separate thing.
--
-- WHY NOT IP. Deliberately no IP column, and no IP-based blocking anywhere.
-- Mobile networks and corporate NAT put unrelated people behind one address and
-- move one person across several, and the link scanners in Outlook and Gmail
-- fetch a URL before the recipient ever clicks it. An opaque first-party cookie
-- asks nothing of the visitor and does not pretend to be an identity.
--
-- WHAT THIS IS AND IS NOT FOR. Visibility, never enforcement. A high count is
-- not proof of anything: a phone plus a laptop is two, and entirely normal. The
-- founder gets the raw number and decides; nothing here revokes, hides or
-- blocks. The real non-transferability guarantee is unchanged and lives
-- elsewhere: /guest/{token} shows names and structure but never content, and
-- the actual unlock only ever reaches the mailbox the grant names.

create table if not exists public.guest_link_views (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.access_grants(id) on delete cascade,
  -- Opaque, random, first-party, set by the guest route on first open and sent
  -- back on later ones. Distinguishes "one person reloading" from "a second
  -- device"; identifies nobody.
  visitor_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  view_count int not null default 1,
  unique (grant_id, visitor_key)
);

create index if not exists guest_link_views_grant_idx on public.guest_link_views (grant_id);

alter table public.guest_link_views enable row level security;

-- Founders read their own org's rows through the grant. No write policy at all:
-- every insert/update comes from the guest route with the service-role key, the
-- same shape contribution_points uses (0289) — anon and authenticated can never
-- forge or inflate a view.
create policy guest_link_views_select_own_org on public.guest_link_views
  for select using (
    exists (
      select 1 from public.access_grants g
      where g.id = guest_link_views.grant_id and public.is_org_member(g.org_id)
    )
  );

revoke all on public.guest_link_views from anon;
