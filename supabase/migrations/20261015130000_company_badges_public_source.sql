-- Prompt 918 — badges & awards: only the verified ones reach the investor, each with a public source and a logo; the verification is
-- charged. (Prompt 326 created the table in 0219_company_badges.sql; this adds to it.)
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". Rehearsed against production data inside ONE DO statement that always ends in
-- RAISE EXCEPTION (scripts/verify-company-badges-918.sql, which embeds THIS file verbatim, so the rehearsal can never drift from what is
-- applied).
--
-- WHAT IT DOES
--   1. Columns: source_url, source_title, source_found_by ('founder' | 'sherlock'), logo_url, kind (award | certification | programme |
--      recognition), updated_at. (verified_at already exists, from 0219.)
--   2. Backfill: a badge that is `verified` but has no source goes back to `unverified` with the note 'Re-verify to attach a public source'
--      — from now on "verified" means "there is a public page to point at". Today that is ONE row (listed in the report: Mob2is,
--      "Altice Innovation Awards", verified 14/10 on a note that says the company was a finalist). Nothing else in the table changes.
--   3. The table refuses what the rule forbids: a `verified` row without a source and a date cannot exist (CHECK), and the kind, the
--      source_found_by and the lengths are checked.
--   4. A guard trigger. company_badges' RLS policy lets any member of the org write ANY column through PostgREST with their own session
--      (Prompt 326 designed it for a form, not for a verdict), so a founder could mark a badge "verified" from the browser console and
--      the investor would see it. The trigger makes the verdict's own columns — status, note, date, found title, found logo, who found the
--      source — writable only by the service role (our routes) and by the database owner (migrations, the SQL editor): for an end-user
--      session they are forced back to what they were (an INSERT starts unverified), and an edit of the name, the year or the source of a
--      badge already ruled on sends it back to unverified. Silent by design: a client that sends the whole row unchanged keeps working.
--   5. updated_at is touched on every update.
--   6. ai_actions gets 'badge_verification' (5 credits) so charge_ai_action() can meter it and Backoffice > AI credits & plans shows and edits it
--      like every other action. ON CONFLICT DO NOTHING: a row someone already edited is never overwritten.
--
-- Additive except for the backfill (one row) and the three CHECKs, which the backfill is ordered to satisfy.

-- 1. columns
alter table public.company_badges
  add column if not exists source_url text,
  add column if not exists source_title text,
  add column if not exists source_found_by text,
  add column if not exists logo_url text,
  add column if not exists kind text not null default 'award',
  add column if not exists updated_at timestamptz not null default now();

-- 2. backfill — BEFORE the CHECK that would refuse these rows
update public.company_badges
   set verification_status = 'unverified', verified_at = null, verification_note = 'Re-verify to attach a public source'
 where verification_status = 'verified' and (source_url is null or btrim(source_url) = '');

-- 3. what the table itself refuses
alter table public.company_badges drop constraint if exists company_badges_kind_check;
alter table public.company_badges add constraint company_badges_kind_check
  check (kind in ('award', 'certification', 'programme', 'recognition'));
alter table public.company_badges drop constraint if exists company_badges_source_found_by_check;
alter table public.company_badges add constraint company_badges_source_found_by_check
  check (source_found_by is null or source_found_by in ('founder', 'sherlock'));
alter table public.company_badges drop constraint if exists company_badges_source_lengths_check;
alter table public.company_badges add constraint company_badges_source_lengths_check
  check ((source_url is null or char_length(source_url) <= 2000)
     and (logo_url is null or char_length(logo_url) <= 2000)
     and (source_title is null or char_length(source_title) <= 300));
alter table public.company_badges drop constraint if exists company_badges_verified_has_source_check;
alter table public.company_badges add constraint company_badges_verified_has_source_check
  check (verification_status <> 'verified' or (source_url is not null and btrim(source_url) <> '' and verified_at is not null));

-- 4. the guard: the verdict is written only by the service role and the database owner
-- SECURITY INVOKER on purpose (the default): the function reads only the row and auth.role(), so it needs no owner privileges — and a
-- SECURITY DEFINER function in `public` shows up in the Supabase advisor as executable by anon/authenticated (0028/0029), one more warning
-- for something that has nothing to protect. (Triggers fire without an EXECUTE check on the firing role; the rehearsal proves it as `authenticated`.)
create or replace function public.company_badges_protect_verification()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Only an end-user session (the founder's own browser talking to PostgREST) is constrained. Our routes run as the service role;
  -- migrations and the SQL editor run as the database owner, with no JWT at all.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.verification_note := null;
    new.verified_at := null;
    new.source_title := null;
    new.logo_url := null;
    new.source_found_by := case when new.source_url is null then null else 'founder' end;
    return new;
  end if;

  if new.name is distinct from old.name or new.year is distinct from old.year or new.source_url is distinct from old.source_url then
    -- what was verified was THIS name, THIS year, THIS source: change one and the old verdict no longer describes the page
    if old.verification_status <> 'unverified' then
      new.verification_status := 'unverified';
      new.verification_note := 'Edited — verify again to show it to investors';
      new.verified_at := null;
    else
      new.verification_status := old.verification_status;
      new.verification_note := old.verification_note;
      new.verified_at := old.verified_at;
    end if;
    new.source_title := null;
    new.logo_url := null;
    -- who found the source changes only when the source itself did
    new.source_found_by := case
      when new.source_url is not distinct from old.source_url then old.source_found_by
      when new.source_url is null then null
      else 'founder'
    end;
  else
    new.verification_status := old.verification_status;
    new.verification_note := old.verification_note;
    new.verified_at := old.verified_at;
    new.source_found_by := old.source_found_by;
    new.source_title := old.source_title;
    new.logo_url := old.logo_url;
  end if;
  return new;
end;
$$;

drop trigger if exists company_badges_protect_verification on public.company_badges;
create trigger company_badges_protect_verification
  before insert or update on public.company_badges
  for each row execute function public.company_badges_protect_verification();

-- 5. updated_at (fires after the guard: triggers run in name order)
drop trigger if exists company_badges_touch on public.company_badges;
create trigger company_badges_touch
  before update on public.company_badges
  for each row execute function public.touch_updated_at();

-- 6. the action the wallet meters
insert into public.ai_actions (key, label, category, credit_cost, needs_confirmation, enabled)
values ('badge_verification', 'Badge verification — public-source check', 'client', 5, false, true)
on conflict (key) do nothing;
