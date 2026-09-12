-- Prompt 604 §A — the commitments page is advertising, not a contract. The
-- Terms are the contract and are already accepted at signup; this page is
-- shown once after signup and what it needs is a mark of "seen", not an
-- acceptance row with a version. Prompt 603 had recorded it in
-- terms_acceptances under 'commitments-1.0' — the table of the contract, and
-- precisely the confusion 604 asks to avoid. It would also have been a bug:
-- /api/terms/status reads that table's latest row REGARDLESS of version, so
-- a 'commitments-1.0' row would have shadowed the person's Terms acceptance
-- and re-gated the Terms. Zero such rows were ever written (the gate was
-- never switched on), so nothing is migrated out.
--
-- A boolean on the membership row — per account, 604's own words ("um
-- booleano, não uma linha de aceitação com versão"). Additive; reversible by
-- dropping the column. Existing accounts start at false, so each sees the
-- page once when the gate is switched on, which is the intended behaviour.
alter table public.org_members
  add column if not exists commitments_seen boolean not null default false;
