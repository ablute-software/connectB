-- Prompt 99 §2/§3.3 — new document-review kinds for the Review & Optimize
-- expansion. dataroom_completeness_check is deliberately NOT added here —
-- the prompt's own §2.6 specifies it needs no AI call, just a structural
-- comparison against documents/folders, so it doesn't belong in this enum.
alter type public.ai_review_kind add value 'business_plan_review';
alter type public.ai_review_kind add value 'financial_plan_review';
alter type public.ai_review_kind add value 'marketing_plan_review';
alter type public.ai_review_kind add value 'cap_table_review';
