-- Prompt 626 §D + §C — the rights channel gets the two things it was missing:
-- all four rights, and a deadline that exists in the row rather than in
-- somebody's head. Plus §C's retention period as something the database can
-- actually execute.
--
-- WHY THE ENUM ONLY HAD TWO. `gdpr_kind` was written for the founder-CRM
-- case: a person in a startup's private People list asks for a correction or
-- a deletion. Article 15 (access) and Article 21 (objection) were never
-- offered, so nobody could exercise them — and objection is the one Article
-- 21(2) makes absolute for direct marketing, which is precisely what a
-- catalogue of investors exists to enable. Two of the four rights the public
-- notice promises could not be recorded.
--
-- WHY due_at IS A COLUMN AND NOT A CALCULATION. Prompt 626 §D: "a data-limite
-- calculada à entrada — não a contar mentalmente depois." A due date derived
-- at read time is fine until the rule changes; then every historical row
-- silently re-dates itself. The date we committed to is a fact about the
-- request, so it is stored on the request.
--
-- It is set by a trigger rather than a DEFAULT because it must agree with
-- created_at, and a DEFAULT of now() + interval '1 month' quietly disagrees
-- with any row whose created_at was supplied. It is not a GENERATED column
-- because timestamptz + interval '1 month' is STABLE, not IMMUTABLE — month
-- arithmetic depends on the session TimeZone — and Postgres will not accept a
-- stable expression there.

-- ---------------------------------------------------------------- the rights
alter type public.gdpr_kind add value if not exists 'access';
alter type public.gdpr_kind add value if not exists 'object';

-- ----------------------------------------------------------------- the clock
alter table public.gdpr_requests
  -- The deadline in force at the moment the request arrived: Article 12(3)'s
  -- one month, as a calendar month (1 February + one month is 1 March, which
  -- is 28 days — a flat 30 would have promised two days we do not have).
  add column if not exists due_at timestamptz,
  -- An extension is a COMMITMENT MADE TO SOMEBODY, not extra room we take.
  -- Article 12(3) allows two further months and requires the person to be
  -- told, within the first month, with the reason. All three are recorded, and
  -- the trigger below makes the row unwritable without them.
  add column if not exists extended_until timestamptz,
  add column if not exists extension_reason text,
  add column if not exists extension_notified_at timestamptz,
  -- Where the request arrived from, so "we never heard from them" and "it came
  -- in and nobody routed it" stay distinguishable.
  add column if not exists source text not null default 'public_form',
  -- Prompt 616 §B.3 — "quem é, que perfil". Which population the claimant
  -- says they belong to; it decides where we look, and it is their claim, not
  -- our finding, so it is never used as proof of identity.
  add column if not exists claimant_profile text;

update public.gdpr_requests set due_at = created_at + interval '1 month' where due_at is null;
alter table public.gdpr_requests alter column due_at set not null;

do $$ begin
  alter table public.gdpr_requests add constraint gdpr_requests_extension_is_told
    check (
      extended_until is null
      or (extension_reason is not null and btrim(extension_reason) <> '' and extension_notified_at is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.gdpr_requests add constraint gdpr_requests_source_known
    check (source in ('public_form', 'backoffice', 'in_app'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.gdpr_requests add constraint gdpr_requests_claimant_profile_known
    check (claimant_profile is null or claimant_profile in ('catalog_person', 'product_user', 'other'));
exception when duplicate_object then null; end $$;

create or replace function public.gdpr_request_set_due_at()
returns trigger language plpgsql as $fn$
declare
  v_ceiling timestamptz;
begin
  if tg_op = 'INSERT' then
    -- Never trusted from the client: the deadline is ours to compute.
    new.due_at := new.created_at + interval '1 month';
  end if;

  if new.extended_until is not null then
    v_ceiling := new.created_at + interval '3 months';
    if new.extended_until > v_ceiling then
      -- Refused rather than clamped. A clamp would leave the row saying one
      -- date while the queue showed another, and the difference would only
      -- surface in a complaint.
      raise exception 'An extension may not pass three months from the request (% is beyond %)', new.extended_until, v_ceiling
        using errcode = 'check_violation';
    end if;
    if new.extended_until <= new.due_at then
      raise exception 'An extension must be later than the statutory deadline (% is not after %)', new.extended_until, new.due_at
        using errcode = 'check_violation';
    end if;
    if new.extension_notified_at > new.due_at then
      -- Article 12(3): the person must be told WITHIN the first month. Telling
      -- them afterwards is not an extension, it is an explanation of a delay.
      raise exception 'The person must be told of an extension within the first month (told %, deadline was %)', new.extension_notified_at, new.due_at
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists gdpr_request_set_due_at on public.gdpr_requests;
create trigger gdpr_request_set_due_at
  before insert or update on public.gdpr_requests
  for each row execute function public.gdpr_request_set_due_at();

-- Nearest deadline first is how the queue reads; pending is the only status
-- with a deadline left to miss.
create index if not exists gdpr_requests_pending_due_idx
  on public.gdpr_requests (due_at) where status = 'pending';

comment on column public.gdpr_requests.due_at is
  'Article 12(3) one calendar month from created_at, fixed at insert. Never recomputed.';
comment on column public.gdpr_requests.extended_until is
  'A recorded Article 12(3) extension. Requires a reason and a date the person was told, within the first month; capped at three months from the request.';

-- ------------------------------------------------------------- the retention
-- Prompt 616 §C / 626 §A.3 — Article 14(2)(a) requires a period or the
-- criteria for one, and "forever" is neither defensible nor true. Nuno's
-- number is 24 months (src/lib/controller.ts, CATALOG_RETENTION_MONTHS).
--
-- DRY RUN BY DEFAULT, and deliberately so. This function deletes people. The
-- number it reports is checkable before anything is destroyed, and nothing
-- schedules it yet — the sweep runs the day someone reads its own output and
-- decides to. A retention rule that quietly deleted rows the first time it was
-- written would be a worse failure than not having one.
--
-- "Activity" is the union of everything the notice promises to count: an
-- enrichment touch, a delivery of the person's firm to any org, a privacy
-- notice sent, or an objection recorded. A suppressed person is never swept
-- by this — their suppression row is what keeps them out of the catalogue,
-- and deleting the person does not delete that row (that is the whole point
-- of Prompt 616 §B.4), but sweeping them adds nothing and loses the record of
-- why they are gone.
create or replace function public.catalog_retention_sweep(
  p_months integer default 24,
  p_apply boolean default false
) returns table (person_id uuid, full_name text, entity_id uuid, last_activity_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  return query
  with last_delivery as (
    select d.entity_id as ent, max(d.delivered_at) as at
    from public.catalog_deliveries d
    where d.entity_id is not null
    group by d.entity_id
  ),
  stale as (
    select p.id as pid, p.full_name as nm, p.entity_id as ent,
           greatest(
             p.created_at,
             coalesce(p.updated_at, p.created_at),
             coalesce(p.enriched_at, p.created_at),
             coalesce(ld.at, p.created_at)
           ) as last_at
    from public.catalog_people p
    left join last_delivery ld on ld.ent = p.entity_id
    where p.do_not_contact is not true
      and p.privacy_notice_sent is not true
      -- Both suppression keys, matching catalog_people_block_suppressed: the
      -- normalised LinkedIn URL where there is one, and name + firm where
      -- there is not. Checking only the first would sweep exactly the people
      -- who objected without a LinkedIn profile.
      and not exists (
        select 1 from public.catalog_person_suppressions s
        where (s.linkedin_url_normalized is not null
               and s.linkedin_url_normalized = p.linkedin_url_normalized)
           or (s.name_key is not null
               and s.entity_id is not distinct from p.entity_id
               and s.name_key = public.catalog_person_name_key(p.full_name))
      )
  ),
  doomed as (
    select * from stale where last_at < now() - make_interval(months => p_months)
  ),
  deleted as (
    delete from public.catalog_people cp
    using doomed d
    where p_apply and cp.id = d.pid
    returning cp.id as did
  )
  select d.pid, d.nm, d.ent, d.last_at
  from doomed d
  where (p_apply is false) or (d.pid in (select did from deleted));
end $fn$;

revoke all on function public.catalog_retention_sweep(integer, boolean) from public, anon, authenticated;

comment on function public.catalog_retention_sweep(integer, boolean) is
  'Prompt 616 §C — catalogue people with no activity for N months. Reports by default; deletes only when p_apply is true. Never sweeps a suppressed person.';
