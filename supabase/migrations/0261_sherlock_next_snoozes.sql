-- Prompt 415 §1 — "Leave for later" on a Sherlock Next Clue: snooze one
-- specific candidate (not the whole ladder) until a chosen date.
--
-- Schema-ahead-of-the-UI, same posture as tasks/entities/interactions
-- themselves (CLAUDE.md: the founder CRM content layer isn't on real
-- Supabase yet, everything reads/writes the local demo store) — this
-- wave (415) wires the DEMO STORE only (§1.3); this migration prepares
-- the real table for whenever the founder CRM's own Supabase migration
-- happens, matching this codebase's established pattern of shipping
-- schema ahead of the adapter that will eventually use it.
--
-- Natural key varies by kind (§1.1's own words: "usa o que já identifica
-- esse candidato de forma única, não inventes um id novo") — exactly one
-- of task_id/entity_id/interaction_id/person_id is populated per row,
-- enforced below. RLS mirrors 0001_init.sql's own generic org-scoped
-- policy loop (is_org_member(org_id), for all) — not investor-visible
-- data, so the root privacy rule doesn't apply; this is founder-only,
-- same isolation-by-org as every other CRM table.
--
-- candidate_key: a single generated column coalescing whichever of the 4
-- id columns is set, so "one active row per real candidate" can be a
-- single ORDINARY unique constraint (org_id, kind, candidate_key) rather
-- than 4 separate PARTIAL unique indexes. Confirmed against this
-- codebase's own existing .upsert(...) call sites (every one targets a
-- full PK/unique constraint, e.g. relationship_state's primary key
-- (org_id, entity_id)) — PostgREST's onConflict param only accepts a
-- bare column list, with no way to also supply a partial index's WHERE
-- predicate, so a partial-index target would risk "no unique or
-- exclusion constraint matching ON CONFLICT" the first time this table
-- is actually upserted into. A plain generated-column constraint sidesteps
-- that entirely and keeps the "exactly one natural key" invariant.
create table public.sherlock_next_snoozes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- The full current SherlockNextKind (sherlock-next.ts) — widened past
  -- 415 §1.1's own original 6-value list because Prompt 417 (a parallel
  -- session, landed while this migration was being written) expanded the
  -- real ladder to 12 kinds before this table was ever applied. Kept
  -- consistent with the type rather than re-narrowing it. Only 5 of the
  -- 12 ever get a real row in practice, though — see sherlock-next.ts's
  -- own comment on WHICH ones actually wire snooze-filtering and why the
  -- other 7 (the 6 onboarding/pitch/readiness kinds plus all_clear) don't.
  kind text not null check (kind in (
    'interest_request', 'unclassified_reply', 'follow_up_overdue', 'task_due_today',
    'onboarding_profile', 'onboarding_dataroom', 'onboarding_pipeline', 'onboarding_first_message',
    'ready_to_contact', 'pitch_review', 'readiness_nudge', 'all_clear'
  )),
  task_id uuid references public.tasks(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  interaction_id uuid references public.interactions(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  candidate_key text generated always as (
    coalesce(task_id::text, entity_id::text, interaction_id::text, person_id::text)
  ) stored,
  snoozed_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sherlock_next_snoozes_one_key check (
    (task_id is not null)::int + (entity_id is not null)::int
    + (interaction_id is not null)::int + (person_id is not null)::int = 1
  ),
  unique (org_id, kind, candidate_key)
);

alter table public.sherlock_next_snoozes enable row level security;
create policy sherlock_next_snoozes_all on public.sherlock_next_snoozes for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
