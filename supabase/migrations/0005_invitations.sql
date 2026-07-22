-- NEXT_STEPS Phase 3 — team invitations.
-- Extends org_role with admin/manager and adds the invite queue. Email
-- sending is stubbed (Phase 5 doesn't exist yet) — the invite link is
-- generated and shown for the inviter to copy/send by hand.
--
-- IMPORTANT — apply in two transactions: Postgres won't let a newly added
-- enum value be *used* (e.g. in a policy's `role in (...)` check, or any
-- row referencing it) within the same transaction that added it via
-- `alter type ... add value`. Run the two `alter type` statements below on
-- their own first (commit), then run the rest of this file (the table +
-- policies, which reference 'admin') as a second transaction. If your
-- migration runner wraps the whole file in one transaction automatically,
-- split it into two files/statements instead — confirmed live 22 Jul 2026
-- against the production project (wkjcaoqdvhykrfacsylr).

alter type org_role add value if not exists 'admin';
alter type org_role add value if not exists 'manager';

create type invitation_status as enum ('pending','accepted','revoked','expired');

create table org_invitations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role org_role not null default 'member',
  token uuid not null default uuid_generate_v4() unique,
  status invitation_status not null default 'pending',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);

alter table org_invitations enable row level security;

-- Any org member can see the team's invitations; only owner/admin can create
-- or revoke them. The invitee reads/accepts via service-role API routes
-- (they aren't an org member yet, so RLS can't grant them direct access).
create policy org_invitations_select on org_invitations for select
  using (is_org_member(org_id));
create policy org_invitations_insert on org_invitations for insert
  with check (exists (
    select 1 from org_members m
    where m.org_id = org_invitations.org_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));
create policy org_invitations_update on org_invitations for update
  using (exists (
    select 1 from org_members m
    where m.org_id = org_invitations.org_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

create index on org_invitations (org_id, status);
create index on org_invitations (token);
