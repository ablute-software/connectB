-- Prompt 882 Part A — nothing today records whether an org has ever used
-- Readiness & Train (a real action, not merely opening the tab). This column
-- becomes non-null exactly once, the first time the org runs a Review
-- analysis, generates a Blueprint reading, pulls/saves Market data, or
-- completes a graded Train session — see the guarded updates in
-- src/lib/readiness-usage.ts and its call sites.
alter table orgs add column if not exists readiness_train_first_used_at timestamptz;
