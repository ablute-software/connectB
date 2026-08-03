-- Prompt 110 Block D — five founder-first-call questions, all optional,
-- all investor-side. Additive only, no existing data touched.
alter table public.matchdeal_profiles
  add column accepts_cold_contact boolean,
  add column typical_decision_weeks smallint,
  add column decision_process text,
  add column does_follow_on boolean,
  add column takes_board_seat text check (takes_board_seat in ('always', 'sometimes', 'never'));
