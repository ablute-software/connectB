-- Prompt 922 (Adenda 1, B, 30/10/2026) — evaluation criteria linked to the questions of the form, and criteria that score themselves from a closed answer. Additive only.
-- NOT YET APPLIED (dry run first, then apply — BEFORE the code that reads it is deployed; the "APPLIED" line is stamped afterwards).
--
--   call_eval_criteria.linked_fields  the ids of the form questions or documents the evaluator reads beside the criterion ("Based on these answers"). Ids of THIS call's own fields: a duplicated call remaps them, a template
--                                     used in another call drops the ones that do not exist there.
--   call_eval_criteria.auto_score     the table of points of ONE closed question (single/multiple choice, Yes/No, number or amount) when the criterion scores itself; null = the evaluator scores. Includes "Evaluators may override".
--   call_eval_criteria.link_notice    set when the criterion came from a template or another call without its links: the editor asks to link it to this call's questions.
--   call_eval_scores.source           'manual' (the evaluator scored), 'auto' (the point of the answer) or 'override' (the evaluator changed an automatic point, with a comment).
--   call_eval_scores.auto_value       the automatic point at the time (kept beside an override, and used to warn the administrator when a submitted evaluation no longer matches the application).

alter table public.call_eval_criteria add column if not exists linked_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(linked_fields) = 'array');
alter table public.call_eval_criteria add column if not exists auto_score jsonb check (auto_score is null or jsonb_typeof(auto_score) = 'object');
alter table public.call_eval_criteria add column if not exists link_notice boolean not null default false;
alter table public.call_eval_scores add column if not exists source text not null default 'manual' check (source in ('manual', 'auto', 'override'));
alter table public.call_eval_scores add column if not exists auto_value integer;
