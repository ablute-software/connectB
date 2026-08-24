-- Prompt 341 — Terms & Conditions acceptance record. The document's own
-- "Acceptance" clause promises electronic registration with date/time; this
-- table is that registration.
--
-- Deliberately NO foreign key to auth.users(id): clause 14.4 requires the
-- row to survive account deletion, kept "for evidentiary purposes for the
-- applicable limitation periods". A FK with `on delete cascade` would erase
-- the exact record the clause requires to keep; `on delete set null` isn't
-- possible either since user_id is part of the primary key (NOT NULL by
-- definition) — setting it null would violate that constraint and simply
-- fail the account deletion instead. A plain, unreferenced uuid column is
-- the only shape that satisfies "survives deletion, keeps its identifying
-- value" at once — the same pattern this migration exists to establish.
--
-- insert is server-side only (the accepting route always writes
-- TERMS_VERSION itself — never a client-supplied version), so RLS grants
-- select of one's own row and nothing else; writes go through the
-- service-role admin client, which bypasses RLS entirely.
create table if not exists terms_acceptances (
  user_id uuid not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  email_at_acceptance text not null,
  primary key (user_id, version)
);

alter table terms_acceptances enable row level security;

create policy "terms_acceptances_select_own" on terms_acceptances
  for select using (auth.uid() = user_id);

revoke insert, update, delete on terms_acceptances from anon, authenticated;
