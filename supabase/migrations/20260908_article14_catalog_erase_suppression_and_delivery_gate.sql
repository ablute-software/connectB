-- Prompts 614 §C and 616 §B/§E — the catalogue becomes erasable, erasure
-- sticks, every new person records where they came from, and no catalogue
-- data reaches an external customer until that is true.
--
-- ORDERING HAZARD FOUND WHILE USING THE NEW CONVENTION, and it needs deciding
-- before the next same-day pair. A DATE-ONLY prefix does not order migrations
-- written on the same day: these four sort alphabetically after `20260908_`,
-- which puts `..._suppression_attempts_survive_the_block` BEFORE
-- `..._suppression_trigger_reads_linkedin_url...` — the reverse of the order
-- they were applied in, and a replay from an empty database would therefore
-- end on the superseded trigger body. The ledger's own `version` (a full
-- timestamp) has the right order; the filenames do not.
--
-- The names are LEFT as applied, because §B's other half — ledger name equals
-- filename, verbatim — is the half that makes the 575 verifier mechanical, and
-- renaming these would break it to fix a hypothetical rebuild. The fix for
-- everything after this is one character wider: `YYYYMMDDHHMM_`. Raised for
-- Nuno rather than decided here.
--
-- FIRST FILE UNDER THE NEW NAMING (614 §B): a timestamp instead of a counter,
-- and the ledger `name` must be this filename verbatim. The two decisions
-- together are what make the 575 verifier mechanical instead of heuristic —
-- the filename and the ledger `version` finally say the same thing.
--
-- ONE CORRECTION TO 614 §C, MEASURED BEFORE BUILDING. §C says a clean rebuild
-- from the repo "aplica só a v1 e obtém o alvo anterior à correcção". It does
-- not. `pg_get_functiondef` on the live `erase_gdpr_person` is byte-identical
-- (after the cosmetic normalisation pg_get_functiondef always applies) to the
-- body in supabase/migrations/0321_gdpr_erase_and_resolution.sql, whose own
-- header documents the correction as folded back into that same file. The
-- ledger's `_v2_corrected_target` row is a SECOND APPLICATION of the same
-- file, not an unrecorded change. So there was no reproducibility hole to
-- close, and step 1 of §C had nothing to recover — which is why this file
-- goes straight to the three real defects.

-- ---------------------------------------------------------------------------
-- 616 §B.1 — where each person came from.
--
-- Article 14(2)(f) requires us to say the source, and whether it was publicly
-- accessible. Today we cannot answer that for any of the 3 472 rows.
--
-- `source_confidence` is the honest half: a source we RECORDED at intake and a
-- source we INFERRED afterwards from the entity and the enrichment run are not
-- the same claim, and the difference matters on the day somebody asks. An
-- invented source is worse than an empty field.
alter table public.catalog_people
  add column if not exists source_kind text
    check (source_kind is null or source_kind in ('firm_website', 'public_profile', 'founder_contribution', 'enrichment_run', 'manual')),
  add column if not exists source_url text,
  add column if not exists source_confidence text
    check (source_confidence is null or source_confidence in ('recorded', 'inferred')),
  add column if not exists source_recorded_at timestamptz;

comment on column public.catalog_people.source_confidence is
  'recorded = captured at intake, from the path that created the row. inferred = reconstructed afterwards from the entity and the enrichment run. Never blank one into the other: Article 14(2)(f) is answered differently by the two.';

-- ---------------------------------------------------------------------------
-- 616 §B.4 — suppression that survives the next collection run.
--
-- "Marcar do_not_contact na linha não chega, porque o enriquecimento volta a
-- criar a linha na corrida seguinte." The key therefore lives OUTSIDE the row
-- and outlives deleting it: the normalised LinkedIn URL where there is one,
-- and a normalised name plus entity where there is not.
--
-- 616's own closing note is why this is here and not in a second table: the
-- erase path of 614 §C and the objection path of 616 §B.4 have to end in the
-- SAME suppression list, or we get two and one of them is wrong.
create table if not exists public.catalog_person_suppressions (
  id uuid primary key default uuid_generate_v4(),
  -- The stable key. At least one of these two identities must be present.
  linkedin_url_normalized text,
  name_key text,
  entity_id uuid references public.catalog_entities(id) on delete set null,
  reason text not null,
  origin text not null check (origin in ('gdpr_erase', 'objection', 'manual')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  constraint catalog_person_suppressions_has_a_key
    check (linkedin_url_normalized is not null or name_key is not null)
);

create unique index if not exists catalog_person_suppressions_linkedin_uniq
  on public.catalog_person_suppressions (linkedin_url_normalized)
  where linkedin_url_normalized is not null;
create unique index if not exists catalog_person_suppressions_name_uniq
  on public.catalog_person_suppressions (name_key, entity_id)
  where linkedin_url_normalized is null and name_key is not null;

-- "e a tentativa fica registada" — the proof that suppression is holding.
-- Without it, a blocked re-creation is indistinguishable from a person the
-- collector simply never saw again.
create table if not exists public.catalog_person_suppression_attempts (
  id bigserial primary key,
  suppression_id uuid references public.catalog_person_suppressions(id) on delete set null,
  linkedin_url_normalized text,
  full_name text,
  entity_id uuid,
  attempted_at timestamptz not null default now()
);
create index if not exists catalog_person_suppression_attempts_at_idx
  on public.catalog_person_suppression_attempts (attempted_at desc);

alter table public.catalog_person_suppressions enable row level security;
alter table public.catalog_person_suppression_attempts enable row level security;
-- No policy at all: these are read and written by the service role only. A
-- suppression list that a founder could read is a way of asking "is this
-- person in your database", which is the oracle 616 §B.3 warns against.
revoke all on public.catalog_person_suppressions from public, anon, authenticated;
revoke all on public.catalog_person_suppression_attempts from public, anon, authenticated;

-- The name key, so the erase path and the trigger cannot normalise differently.
create or replace function public.catalog_person_name_key(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '');
$function$;

-- THE ENFORCEMENT, and it is a trigger rather than a check in the callers on
-- purpose. There are at least four paths that create a catalogue person — the
-- enrichment worker (an Edge Function), /api/backoffice/catalog/people,
-- contribute_catalog_person, and ad-hoc scripts — and a rule enforced in four
-- places is a rule enforced in three. The database is the one place all four
-- go through.
--
-- It RAISES rather than silently dropping the row: the worker already treats a
-- failed insert as "skip this person, continue the batch" (its own comment
-- says so), so a loud refusal costs nothing there and is visible everywhere
-- else.
create or replace function public.catalog_people_block_suppressed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_sup public.catalog_person_suppressions%rowtype;
  v_entity uuid;
begin
  select s.* into v_sup from public.catalog_person_suppressions s
  where (new.linkedin_url_normalized is not null and s.linkedin_url_normalized = new.linkedin_url_normalized)
  limit 1;

  if v_sup.id is null then
    -- The affiliation is not written yet at BEFORE INSERT time, so the entity
    -- match uses the column on the row when it carries one.
    v_entity := new.entity_id;
    select s.* into v_sup from public.catalog_person_suppressions s
    where s.linkedin_url_normalized is null
      and s.name_key = public.catalog_person_name_key(new.full_name)
      and (s.entity_id is null or s.entity_id is not distinct from v_entity)
    limit 1;
  end if;

  if v_sup.id is null then
    return new;
  end if;

  insert into public.catalog_person_suppression_attempts (suppression_id, linkedin_url_normalized, full_name, entity_id)
  values (v_sup.id, new.linkedin_url_normalized, new.full_name, new.entity_id);

  raise exception 'catalog person is suppressed and cannot be re-created (suppression %)', v_sup.id
    using errcode = 'restrict_violation';
end;
$function$;

drop trigger if exists catalog_people_block_suppressed on public.catalog_people;
create trigger catalog_people_block_suppressed
  before insert on public.catalog_people
  for each row execute function public.catalog_people_block_suppressed();

-- ---------------------------------------------------------------------------
-- 614 §C.2 — the erase itself. Three defects, confirmed against the live body:
--
--  1. It ran over public.people and nothing else. The people who will actually
--     exercise the right are in catalog_people (3 472 rows, 1 883 LinkedIn
--     URLs, zero privacy notices sent) — the one population it could not
--     reach.
--  2. It matched on people.email_verified, which is populated on 3 of 1 782
--     rows. A request would have returned people_rows: 0 and looked like a
--     success.
--  3. `ilike p_claimant_email` treats the claimant's own address as a pattern:
--     a_b@x.com also erases aXb@x.com, irreversibly, and the record says it
--     was legitimate. An email address wants equality, not a match.
--
-- Erasure on the catalogue side is a real DELETE, unlike the people side.
-- The reason is the reverse of the one that made people an UPDATE: nothing has
-- a hard FK to catalog_people that needs the row to survive, and leaving a
-- pseudonymised husk in a table whose entire purpose is "people we collected
-- without asking" is the opposite of what was asked for. The suppression row
-- is what remains, and it holds no personal data beyond the key needed to
-- keep them out.
create or replace function public.erase_gdpr_person(p_claimant_email text, p_admin_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_email text;
  v_ids uuid[];
  v_org_count int;
  v_catalog_ids uuid[];
  v_catalog_rows int := 0;
  v_research_rows int := 0;
  v_suppressed int := 0;
begin
  if coalesce(btrim(p_claimant_email), '') = '' then
    raise exception 'a claimant email is required to erase';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to erase';
  end if;

  -- Equality on the folded address, never a pattern. This is the fix for
  -- defect 3 and it is the whole of it: no escaping helper can make `ilike`
  -- the right operator for an identifier.
  v_email := lower(btrim(p_claimant_email));

  -- ---- the private, per-org contact table (unchanged behaviour) ----
  select array_agg(id), count(distinct org_id) into v_ids, v_org_count
  from public.people where lower(btrim(email_verified)) = v_email;

  if v_ids is not null and array_length(v_ids, 1) is not null then
    update public.people set
      full_name = '[erased on request]', email_verified = null, phone = null, linkedin_url = null,
      linked_companies = '{}', linked_funds = '{}', do_not_contact = true
    where id = any(v_ids);
  end if;

  -- ---- the catalogue (new) ----
  -- Matched through the research row, which is where a catalogue person's
  -- address lives (email_verified, or the guess the enrichment produced).
  select array_agg(r.person_id) into v_catalog_ids
  from public.catalog_people_research r
  where lower(btrim(coalesce(r.email_verified, ''))) = v_email
     or lower(btrim(coalesce(r.email_guess, ''))) = v_email;

  if v_catalog_ids is not null and array_length(v_catalog_ids, 1) is not null then
    -- Suppress FIRST, so a run that races this cannot re-create them in the
    -- window between the delete and the insert.
    insert into public.catalog_person_suppressions (linkedin_url_normalized, name_key, entity_id, reason, origin, requested_by)
    select cp.linkedin_url_normalized,
           case when cp.linkedin_url_normalized is null then public.catalog_person_name_key(cp.full_name) end,
           cp.entity_id, p_reason, 'gdpr_erase', p_admin_id
    from public.catalog_people cp
    where cp.id = any(v_catalog_ids)
    on conflict do nothing;
    get diagnostics v_suppressed = row_count;

    delete from public.catalog_people_research where person_id = any(v_catalog_ids);
    get diagnostics v_research_rows = row_count;

    delete from public.catalog_people where id = any(v_catalog_ids);
    get diagnostics v_catalog_rows = row_count;
  end if;

  return jsonb_build_object(
    'people_rows', coalesce(array_length(v_ids, 1), 0),
    'orgs_affected', coalesce(v_org_count, 0),
    'catalog_people_rows', v_catalog_rows,
    'catalog_research_rows', v_research_rows,
    'suppressions_added', v_suppressed,
    'erased_at', now(), 'erased_by', p_admin_id, 'reason', p_reason
  );
end;
$function$;

revoke all on function public.erase_gdpr_person(text, uuid, text) from public, anon, authenticated;
grant execute on function public.erase_gdpr_person(text, uuid, text) to service_role;

-- The preview has to show the same scope the erase will touch, or the admin
-- confirms one thing and causes another. Same equality, same tables.
create or replace function public.gdpr_erasure_preview(p_claimant_email text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
    'people_rows', (select count(*) from public.people where lower(btrim(email_verified)) = lower(btrim(p_claimant_email))),
    'orgs_affected', (select count(distinct org_id) from public.people where lower(btrim(email_verified)) = lower(btrim(p_claimant_email))),
    'catalog_people_rows', (
      select count(*) from public.catalog_people_research r
      where lower(btrim(coalesce(r.email_verified, ''))) = lower(btrim(p_claimant_email))
         or lower(btrim(coalesce(r.email_guess, ''))) = lower(btrim(p_claimant_email))
    ),
    'interaction_references', (
      select count(*) from public.interactions i
      join public.people p on p.id = i.person_id
      where lower(btrim(p.email_verified)) = lower(btrim(p_claimant_email))
    )
  );
$function$;

revoke all on function public.gdpr_erasure_preview(text) from public, anon, authenticated;
grant execute on function public.gdpr_erasure_preview(text) to service_role;

-- ---------------------------------------------------------------------------
-- 616 §E — nothing from the catalogue reaches an external customer yet.
--
-- Today's 824 deliveries went to seven orgs, all internal — which is why
-- Article 14(3)(c) has not fired: disclosing to our own accounts is not
-- disclosure to a third party. The first external delivery turns a deadline
-- met on time into a breach with a date on it.
--
-- A trigger, again because there are at least six write paths (four SQL
-- functions and four TypeScript call sites), and a condition added to one of
-- them is a condition missing from five.
create table if not exists public.platform_settings (
  key text primary key,
  value text not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;

insert into public.platform_settings (key, value, note)
values (
  'catalog_delivery_external_enabled', 'false',
  'Prompt 616 §E — set to true only once the Article 14 notice, the rights channel and the suppression list are live. Until then no catalogue delivery may reach an org with is_internal = false.'
) on conflict (key) do nothing;

create or replace function public.catalog_deliveries_block_external()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_internal boolean;
  v_enabled text;
begin
  select is_internal into v_internal from public.orgs where id = new.org_id;
  if coalesce(v_internal, false) then
    return new;
  end if;

  select value into v_enabled from public.platform_settings where key = 'catalog_delivery_external_enabled';
  if coalesce(v_enabled, 'false') = 'true' then
    return new;
  end if;

  raise exception 'catalogue delivery to an external org is disabled until the Article 14 notice and rights channel are live (platform_settings.catalog_delivery_external_enabled)'
    using errcode = 'restrict_violation';
end;
$function$;

drop trigger if exists catalog_deliveries_block_external on public.catalog_deliveries;
create trigger catalog_deliveries_block_external
  before insert on public.catalog_deliveries
  for each row execute function public.catalog_deliveries_block_external();
