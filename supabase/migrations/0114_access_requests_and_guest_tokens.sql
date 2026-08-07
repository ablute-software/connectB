-- Prompt 121 §2.5 + §2.6-invite — APPLIED (confirmed in production,
-- 2026-08-06; this header previously said "PROPOSED, NOT APPLIED", which
-- was stale and wrong by the time item 1 of the 2026-08-06 mini-prompt
-- batch was written).
-- Two additive, independent pieces:
--
-- 1. access_requests — backs the "Access requested" tab on the investor's
--    new "Access granted" page. Today's model only has founder-initiated
--    grants (access_grants); an investor REQUESTING access is a new
--    concept with no existing table. Status transitions are exclusive by
--    the app layer, not a DB constraint: pending -> granted (the founder
--    creates a real access_grants row and this row's status flips) or
--    pending -> declined. A row never appears in two tabs at once because
--    the client reads status, not table membership, to decide which tab.
--
-- 2. guest_token/guest_token_expires_at on access_grants — backs §2.6's
--    "unknown email -> invite to the data room" flow. Deliberately NOT a
--    new table: an invite grant already represents exactly "these
--    documents, this person" (see migration 0045's invited_email/
--    invited_name/confirmed_at), so a guest link is just another way to
--    resolve the SAME grant row without requiring a real magic-link
--    session first. Single-use is enforced by the app layer clearing the
--    token (or by expires_at), same trust level the existing 5-minute
--    MatchDeal pairing tokens use (see matchdeal-pairing.ts) — opaque,
--    generated server-side, never guessable.
--
-- Both pieces are inert until this migration is applied: the app checks
-- for them via a capability probe (access-requests-capability.ts) and
-- hides the dependent UI (the Requested tab's real content, the
-- "Invite {email} to the data room" button, the guest preview page)
-- behind it — nothing here is silently half-wired.

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  requested_email text,
  folder_ids uuid[] not null default '{}'::uuid[],
  document_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'pending' check (status = any (array['pending', 'granted', 'declined'])),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint access_request_has_requester check (person_id is not null or requested_email is not null)
);
create index if not exists access_requests_org_status_idx on public.access_requests (org_id, status);

alter table public.access_requests enable row level security;

-- Same trust boundary as access_grants: founders (org members) manage
-- requests for their own org through normal RLS; investors reach this
-- exclusively through service-role API routes (no policy grants investor
-- table reads here, matching access_grants's own established convention —
-- see 0001_init.sql's note on that).
create policy access_requests_org_members_select on public.access_requests
  for select using (is_org_member(org_id));
create policy access_requests_org_members_update on public.access_requests
  for update using (is_org_member(org_id));

alter table public.access_grants
  add column if not exists guest_token text,
  add column if not exists guest_token_expires_at timestamptz;
create unique index if not exists access_grants_guest_token_idx on public.access_grants (guest_token) where guest_token is not null;
