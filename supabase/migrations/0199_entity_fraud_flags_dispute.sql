-- Prompt 285 §2 — a founder who filed (or is now living with) a fraud
-- report can say "this may have been a mistake" without a self-service
-- undo — undoing alone would defeat the point of the report (see 0196's
-- own "só a revisão da plataforma decide"). Three columns on the SAME
-- entity_fraud_flags row, not a new table: the simpler of the two options
-- weighed in the prompt itself, reusing the "no new audit columns needed
-- on entities" reasoning 0196 already established (the justification/
-- evidence text belongs on the flag, not duplicated elsewhere).
-- Deliberately NOT reviewer_notes (that column is the ADMIN's own text,
-- written at resolve time — conflating a founder's dispute reason into
-- the same field would mix two different authors' text on one column).
--
-- A dispute always re-arms status='pending' (a data write in the route,
-- not a schema concern here) — whether the flag was still pending or
-- already actioned/confirmed. This is why [id]/resolve/route.ts needs NO
-- code change at all: its existing 409 guard only checks status, and the
-- existing 'dismissed' outcome already does exactly what a successful
-- dispute should trigger (release entities.hard_filter_status back to
-- 'open') — reviewed_by/reviewed_at/outcome from a PRIOR decision are left
-- untouched as history, simply overwritten if the admin resolves again.
alter table public.entity_fraud_flags
  add column if not exists dispute_reason text,
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid references auth.users(id);
