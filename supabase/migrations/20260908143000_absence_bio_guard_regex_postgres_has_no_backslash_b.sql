-- Fix inside Prompt 621 §D, found by running the guard against a fixture
-- rather than by reading it.
--
-- The first pattern used `\b` for a word boundary. THAT IS PCRE, NOT POSTGRES:
-- in Postgres advanced regular expressions `\b` is a BACKSPACE character, and
-- the word-boundary escape is `\y`. So that branch read
-- "…[^.]*<backspace>(was|were|is|are)?…" and could never match.
--
-- The trigger existed, was enabled, and let the exact sentence it was written
-- to stop go straight through. Measured on a zz-test fixture before this fix:
-- the absence bio saved, and both writes reached the history table. A guard
-- that is installed and silently inert is worse than no guard, because the
-- next person reads the migration and believes the case is covered.
--
-- The replacement uses no boundary escapes at all, and every branch was tested
-- against seven positives and five negatives BEFORE being applied — including
-- "She led the no-code platform team" and "found the first ten customers",
-- which a looser pattern would have eaten.
create or replace function public.company_people_reject_absence_bio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.bio is not null and new.bio ~* '(no +(additional|further|other|more)? *(information|details?|data|material)[^.]*(provided|available|supplied|found|given))|(nothing[^.]*(provided|available|found|known|stated))|((materials?|documents?|sources?)[^.]*(do not|does not|did not|don''t|didn''t)[^.]*(contain|include|mention|provide|say))|(insufficient|not enough|limited) +(information|detail|material|data)|(unable to|could not) +(find|locate|verify|confirm)' then
    raise exception 'a bio cannot state that information was not provided — leave it empty and ask instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
