-- Prompt 924 (acerto, 29/10/2026) — what a "Not a fit" is told about WHY. Additive only.
-- NOT YET APPLIED (dry run first, then apply — BEFORE the code that reads it is deployed; the "APPLIED" line is stamped afterwards).
--
--   call_result_settings.eligibility_reason_mode   'none' (default: not mentioned), 'general' (one general sentence) or 'rule' (the sentence of the requirement that was not met). It replaces the on/off
--                                                  include_eligibility_reason, which told the applicant the platform's own text or a person's internal justification: never again. The old column is kept
--                                                  (nothing is dropped); an entity that had it ON starts on 'general'.

alter table public.call_result_settings add column if not exists eligibility_reason_mode text not null default 'none' check (eligibility_reason_mode in ('none', 'general', 'rule'));
update public.call_result_settings set eligibility_reason_mode = 'general' where include_eligibility_reason is true and eligibility_reason_mode = 'none';
