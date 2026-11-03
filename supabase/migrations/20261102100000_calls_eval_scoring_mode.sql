-- Prompt 922 (Adenda 3, 02/11/2026) — how the criteria are combined into the final score: weighted (as always) or equal weight, with the sum of the points or the average. Additive only.
-- APPLIED on 02/11/2026 to wkjcaoqdvhykrfacsylr (dry run in a rolled-back transaction first: the one existing row took the defaults), BEFORE the code that reads it was deployed.
--
--   call_eval_settings.scoring_mode        'weighted' (default: every call that exists stays as it is) or 'equal' (every criterion counts the same; the weights, if any, stay stored but hidden).
--   call_eval_settings.equal_aggregation   with 'equal': 'sum' (default: the sum of the points, "23 / 30 points") or 'average' (on the scale when it is the same everywhere, in % when it is not).

alter table public.call_eval_settings add column if not exists scoring_mode text not null default 'weighted' check (scoring_mode in ('weighted', 'equal'));
alter table public.call_eval_settings add column if not exists equal_aggregation text not null default 'sum' check (equal_aggregation in ('sum', 'average'));
