-- Verification follow-up (V4) — permanent hygiene rule for AI-review
-- verification rows. PROPOSE ONLY, DO NOT APPLY without Nuno's explicit
-- go-ahead (same standing rule as every other schema change this session).
--
-- Root cause this fixes: cleanup of ai_reviews rows created for live
-- verification has depended entirely on someone remembering to delete them
-- at the end of a session. It didn't happen in 4 of 10 rows found during
-- the Prompt 117 verification pass — not because the discipline is wrong,
-- but because a "delete when done" promise has no enforcement if the
-- session ends, crashes, or simply moves on before doing it. A column set
-- at INSERT time doesn't depend on anyone remembering anything afterward.
--
-- Scope: marks rows created by THIS session's own verification scripts
-- (via the service-role admin client, never through the app's normal
-- founder-facing insert path in /api/ai-review — real reviews are never
-- marked true). Defaults to false so every existing and future real row is
-- unaffected until a verification script explicitly sets it.
alter table public.ai_reviews
  add column if not exists is_test boolean not null default false;

create index if not exists ai_reviews_is_test_idx on public.ai_reviews (org_id, is_test) where is_test;
