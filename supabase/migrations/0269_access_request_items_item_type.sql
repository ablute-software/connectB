-- Prompt 423 §A.2 — a new, optional, extensible column so the founder and
-- the Next Clue ladder can recognize WHAT KIND of document a request is
-- about without depending on parsing requested_label's free text. null for
-- every existing request (nothing changes for them); set only by the new
-- "Request cap table from the founder" button (item_type='cap_table').
alter table public.access_request_items
  add column if not exists item_type text check (item_type is null or item_type in ('cap_table'));

-- Prompt 423 §B — widens the existing kind check constraint (0261) to
-- admit the new SherlockNextKind. Same drop+recreate shape that migration
-- already establishes for itself; every existing row's kind is untouched.
alter table public.sherlock_next_snoozes drop constraint if exists sherlock_next_snoozes_kind_check;
alter table public.sherlock_next_snoozes add constraint sherlock_next_snoozes_kind_check check (kind in (
  'interest_request', 'unclassified_reply', 'follow_up_overdue', 'task_due_today',
  'onboarding_profile', 'onboarding_dataroom', 'onboarding_pipeline', 'onboarding_first_message',
  'ready_to_contact', 'pitch_review', 'readiness_nudge', 'all_clear', 'cap_table_request'
));
