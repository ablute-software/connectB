-- Prompt 884 — the Today redesign's "Mark prepared" action on a meeting
-- 1-2 days out. No "prepared" concept exists anywhere in the schema today
-- (checked before writing this) — this is not overloading `notes` or
-- `done` (which Prompt 883's own migration 0351 already established the
-- norm against: a distinct nullable timestamp column per distinct
-- concept, never folding a new meaning into an existing field).
alter table tasks add column if not exists prepared_at timestamptz;
