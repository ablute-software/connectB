-- Prompt 922 (Adenda 2, 30/10/2026) — "How applicants see this rule": a sentence the ENTITY writes, for the applicant, on each eligibility rule. Additive only.
-- NOT YET APPLIED (dry run first, then apply — BEFORE the code that reads it is deployed; the "APPLIED" line is stamped afterwards).
--
--   call_eligibility_rules.applicant_text   what a "Not a fit" applicant is told when this rule was not met and the entity chose "the criterion not met" for the result email ("This call is for companies that
--                                           have already received funding."). Never the engine's text, never the question or the answer. null = none: the general sentence is used.

alter table public.call_eligibility_rules add column if not exists applicant_text text;
