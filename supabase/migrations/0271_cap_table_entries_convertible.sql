-- Prompt 432 §A — a cap table investor row can represent money already
-- invested but not yet converted to equity (SAFE, convertible note, etc.)
-- — until now `pct` was the only field, forcing either a lie (0%) or a
-- made-up percentage. is_convertible + an exact-shape conversion trigger
-- (date XOR event, never both, never neither once convertible) lets the
-- founder record this honestly.
--
-- agreement_document_id points at the founder's OWN Vault document (never
-- exposed to the investor via the dossier fetch — see dossier-fetch.ts's
-- own comment, Prompt 434 §C); on delete set null rather than cascade, so
-- deleting the supporting document never silently deletes the cap table
-- row itself.
--
-- Deliberately out of scope, per the prompt's own instruction: invested
-- amount, valuation cap, discount — not asked for, can come later if
-- needed.
alter table public.cap_table_entries
  add column is_convertible boolean not null default false,
  add column conversion_trigger_type text check (conversion_trigger_type in ('date', 'event')),
  add column conversion_date date,
  add column conversion_event text,
  add column agreement_document_id uuid references public.documents(id) on delete set null;

-- Exact shape: non-convertible carries no trigger field at all; convertible
-- carries EXACTLY one of the two (never both, never neither).
alter table public.cap_table_entries
  add constraint cap_table_entries_conversion_trigger_shape check (
    (is_convertible = false and conversion_trigger_type is null and conversion_date is null and conversion_event is null)
    or (is_convertible = true and conversion_trigger_type = 'date' and conversion_date is not null and conversion_event is null)
    or (is_convertible = true and conversion_trigger_type = 'event' and conversion_event is not null and conversion_date is null)
  );
