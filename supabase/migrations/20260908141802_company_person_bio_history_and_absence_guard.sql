-- Prompt 621 §C.2 and §D — an AI write over a founder's own text leaves a
-- record, and a bio that announces the machine's ignorance cannot be saved.
--
-- FIRST FILE UNDER THE FOURTEEN-DIGIT NAME (619 §B): the same shape
-- `supabase migration new` generates and the exact shape of the ledger's
-- `version`, so filename order equals applied order by construction.
--
-- WHAT HAPPENED, from production rather than from the report. At 09:48:23 on
-- 2026-09-08 someone ran /api/company/team-sherlock-research for org
-- 48a7c481… (ai_call_log has the row — the trace 621 §A could not find was
-- there, in the one table it had not looked in). Three minutes later, at
-- 09:51:43, :44 and :46, the three founder bios were replaced with
--
--   "<name> serves as <title> of the company. No additional information was
--    provided in the materials."
--
-- Three seconds apart is a person clicking Replace three times, not a batch
-- job. Which makes it worse rather than better: the panel OFFERED an
-- assertion of absence as a draft, and accepting it was one click per person.
--
-- The prior text is unrecoverable. It is in no snapshot, no review run, no
-- extraction and no audit row, because nothing recorded it — which is exactly
-- the gap this migration closes.

-- ---------------------------------------------------------------------------
-- §C.2 — the history. Every change to a founder-written field, whoever made
-- it, with the value before and the value after.
--
-- Deliberately NOT admin audit: this is the content's own history, and the
-- writer here is normally the founder's own session, not an admin. It is also
-- deliberately a TRIGGER rather than a call in the write path — the bio is
-- written from the browser through the store, from the AI review panel, and
-- from any future route, and a rule enforced in three places is enforced in
-- two.
create table if not exists public.company_person_field_history (
  id bigserial primary key,
  person_id uuid not null references public.company_people(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  -- auth.uid() when a real session made the change; null for a service-role
  -- write. Never guessed.
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists company_person_field_history_person_idx
  on public.company_person_field_history (person_id, changed_at desc);

alter table public.company_person_field_history enable row level security;

-- The founder reads their own company's history — the point of it is that
-- they can answer "what did this say before". Nobody writes through the API:
-- the trigger below is the only writer.
drop policy if exists company_person_field_history_read on public.company_person_field_history;
create policy company_person_field_history_read on public.company_person_field_history
  for select using (public.is_org_member(org_id) or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- §D — the absence guard, on the WRITE path.
--
-- The generation path already scrubs these sentences (bio-absence-guard.ts,
-- Prompt 613 §C.3), and that guard caught its own author's fallback wording
-- on the first pass. What was missing is that the same rule runs where the
-- value is SAVED — because the value that reached production did not come
-- from the generator returning it, it came from a person clicking Replace on
-- a draft the generator had already produced.
--
-- Kept narrow on purpose. This matches sentences whose whole job is to
-- announce that something is missing; it does not police prose. A founder
-- writing "no formal training, self-taught" is untouched — there is no
-- "provided/available/found" claim about materials in it.
create or replace function public.company_people_reject_absence_bio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.bio is not null and new.bio ~* '(no (additional|further|other|more)?\s*(information|details?|data|material)[^.]*\b(was|were|is|are)?\s*(provided|available|supplied|found|given))|(nothing (else |further |more )?(was |is )?(provided|available|found|known|stated))|((materials?|documents?|sources?)\s+(provided\s+)?(do(es)? not|did not|don''t|didn''t)\s+(contain|include|mention|provide|say))' then
    raise exception 'a bio cannot state that information was not provided — leave it empty and ask instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists company_people_reject_absence_bio on public.company_people;
create trigger company_people_reject_absence_bio
  before insert or update of bio on public.company_people
  for each row execute function public.company_people_reject_absence_bio();

-- The history trigger runs AFTER, so it never records a write the guard above
-- refused. Named to sort after the guard for the same reason.
create or replace function public.company_people_record_bio_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.bio is distinct from old.bio then
    insert into public.company_person_field_history (person_id, org_id, field, old_value, new_value, changed_by)
    values (new.id, new.org_id, 'bio', old.bio, new.bio, auth.uid());
  end if;
  return null;
end;
$function$;

drop trigger if exists company_people_record_bio_change on public.company_people;
create trigger company_people_record_bio_change
  after update of bio on public.company_people
  for each row execute function public.company_people_record_bio_change();
