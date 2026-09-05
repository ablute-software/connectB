-- Prompt 572 §A.3/§B.2/§C.1 — provenance and state-machine columns the new
-- shared Review queue pattern needs, added once rather than per-queue.
--
-- entities.created_by: "New investors" wants to show WHO added a manual
-- entity (not just which org), and there is no such column today. Nullable,
-- backfilled null for the 757 existing manual rows (§B.2's own instruction:
-- "não inventar autor" — show the org only for those, never guess a user).
-- New manual-entity writes from this point on should set it.
alter table public.entities add column if not exists created_by uuid references auth.users(id) on delete set null;
comment on column public.entities.created_by is
  'Who added this row by hand (manual pipeline entry). Null for rows created before Prompt 572 or by a non-interactive path (import, system) — never backfilled with a guess.';

-- contributions.author_system: source='ai' rows have no author_user_id by
-- construction (no human wrote them), but today they also don't say WHICH
-- model/route produced them — "author unknown" and "author is code, and
-- here is which code" have been indistinguishable. Nullable: only AI-
-- sourced rows set it; user-authored rows leave it null and rely on
-- author_user_id instead.
alter table public.contributions add column if not exists author_system text;
comment on column public.contributions.author_system is
  'Which AI route/model produced this row, for source=''ai'' contributions only (e.g. "entity-enrich-gpt4o"). Null for source=''user'' rows — those use author_user_id instead.';
