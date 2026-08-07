-- "Claim this profile" via email domain verification (Nuno's decision B,
-- 2026-08-07 — see the prompt and DECISIONS.md for the full reasoning).
-- PROPOSED, NOT APPLIED — this session never applies its own migrations;
-- the revisor session does, against the exact text below.
--
-- The landing page (/investors) has advertised "Claim this profile" with
-- nothing behind it — same promise-without-code pattern as the plan
-- limits before this fix. This closes it: a signed-in investor with a
-- CONFIRMED email can claim a catalog_entities row, evidence (domain
-- match) is computed and stored at claim time, and a platform admin
-- always makes the final call — domain_match is evidence, never an
-- auto-approve, per the prompt's own explicit safeguard §3.1.

create table if not exists public.investor_entity_claims (
  id uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  claimant_user_id uuid not null references auth.users(id) on delete cascade,
  -- The session's OWN confirmed email (auth.users.email_confirmed_at
  -- checked at claim time by the API route) — never a field the claimant
  -- typed into a form. claimant_email_domain / entity_domain_at_claim are
  -- a snapshot of investor-entity-claims.ts's evaluateClaimDomain() at the
  -- moment of the claim, so a later change to either party's domain can
  -- never retroactively rewrite what a past decision was actually based on.
  claimant_email text not null,
  claimant_email_domain text,
  entity_domain_at_claim text,
  domain_match boolean not null default false,
  status text not null default 'pending' check (status = any (array['pending', 'approved', 'rejected'])),
  requested_role text,
  -- Free-form snapshot of what the reviewing admin saw: domains, the
  -- role-mailbox/freemail flags, dispute context (an existing owner at
  -- claim time), timestamps — enough to reconstruct the decision later
  -- without re-deriving it from mutable state.
  evidence jsonb,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  notified_at timestamptz,
  notify_failed boolean not null default false,
  created_at timestamptz not null default now()
);

-- One PENDING claim per (entity, user) — a partial unique index rather
-- than a plain unique constraint so the same person can claim again later
-- (a fresh pending row) after an earlier claim on the same entity was
-- rejected; only one pending at a time.
create unique index if not exists investor_entity_claims_pending_unique
  on public.investor_entity_claims (catalog_entity_id, claimant_user_id) where status = 'pending';
create index if not exists investor_entity_claims_entity_idx on public.investor_entity_claims (catalog_entity_id);
create index if not exists investor_entity_claims_claimant_idx on public.investor_entity_claims (claimant_user_id);

alter table public.investor_entity_claims enable row level security;
-- Same trust boundary access_requests (0114) already established: the
-- requester reads their own rows through normal RLS; every write (create,
-- approve, reject) goes through a service-role API route, never a client
-- insert/update policy — the domain-match evidence and status transitions
-- are exactly the kind of thing that must not be client-writable.
create policy investor_entity_claims_select_own on public.investor_entity_claims
  for select using (claimant_user_id = auth.uid());

-- The prompt's own §0 states matchdeal_investor_members already has a
-- `role` column — verified against every migration in this repo; it does
-- not. Added here, additive: approving a claim needs somewhere to record
-- the investor's role at the firm (the prompt's own "role adequado" on
-- approval), and per-seat is the right place for it, same as
-- domain_verified already is.
alter table public.matchdeal_investor_members add column if not exists role text;
