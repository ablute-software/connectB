-- Prompt 895 — Promo Codes & Offers: cancel with a message an admin writes
-- (or drafts with AI), shown to whoever next tries to redeem the code.
-- Additive only, no backfill: every existing row gets all three fields
-- null, meaning "never cancelled with a message" — a code deactivated
-- through the existing plain "Deactivate" button before this migration
-- stays exactly that, not retroactively relabelled as "cancelled".
alter table public.promo_codes
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id),
  add column cancellation_message text;
