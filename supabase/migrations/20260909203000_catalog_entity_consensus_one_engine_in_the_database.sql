-- Prompt 632 §2.2–§2.4 — consensus for entities, as ONE engine, in the database.
--
-- WHAT WAS THERE, MEASURED 2026-09-09, and why this is not "a sibling
-- trigger" as §2.2 asked but a consolidation:
--
--   Engine A — catalog_person_check_consensus (0322/0328/0336): a database
--   trigger, but on the `catalog_person` lane only. That subject_type was
--   BORN distinct in 0322 (its header: "a genuinely new subject_type", because
--   `person` already meant the founder's private people). Nothing outside the
--   back-office catalog routes writes it. 0 rows, ever. Not a rename gone
--   wrong — a lane nobody drives on.
--
--   Engine B — Prompt 266's /api/community-consensus/register: an APP route,
--   entity lane, already keyed on the shared catalogue id, already with a
--   per-org `_sources` table, a two-org "community" level, an arbitration
--   cache, a review route and a founder-facing panel. Also 0 rows, ever —
--   there has only been one org. It fires from ONE of the eight places that
--   insert contributions, its normaliser is lower/trim, it has no three-org
--   level, no admin path, no same-source cap — and it never writes the value
--   into catalog_entities, so the catalogue row stays blank even after
--   agreement. That last point is the whole "pobreza de dados" symptom.
--
--   And the structural fact neither prompt saw: the 705 `entity` contributions
--   carry subject_id = entities.id — the PER-ORG row (694/705 match it, 0
--   match a catalogue id). Two orgs describing the same fund write different
--   subject_ids. Consensus has to be keyed on entities.catalog_id (667 of the
--   705 have one), or it can never happen by construction.
--
-- SO: the trigger lives in the database (fires on every insert path), keys on
-- the catalogue id, uses 632 §2.1's per-field normalisers, applies 632 §2.3's
-- levels with precedence, and writes its ledger into Engine B's tables so the
-- panel, the review queue and the vote route keep working untouched. Engine
-- A is left alone: its lane is a different subject. Engine B's route keeps
-- its AI arbiter; its own promotion branch simply becomes unreachable, since
-- by the time the founder's browser calls it the trigger has already scored
-- the row.
--
-- THE FOUR DECISIONS THAT ARE MINE, STATED SO THEY CAN BE OVERRULED:
--
-- 1. Contact fields ARE eligible (email, phone, address, postal_code) — 632
--    §2.2 lists them, Prompt 266 §5 excluded them ("never propagate
--    unverified contact info"). A firm's public hello@ and street address are
--    firm facts, not personal data, and "unverified" is what the two-org /
--    three-org levels and the same-source cap exist to bound. But
--    general_partner_emails is PERSONAL and stays admin-only, per 632 §3.3's
--    own bounce-and-complaint argument. Nuno decides if the line is elsewhere.
-- 2. An existing catalogue value with NO recorded level is treated as rank 2
--    (as if verified_by_startups). 632's precedence table has no row for it,
--    and the alternative — two founders' plausible value overwriting a
--    catalogue value that came from the fund's own website — is the Prompt
--    266 §5 non-clobbering rule being quietly dropped. Only admin or the
--    person/firm themselves can replace it.
-- 3. §3.1: three orgs citing ONE shared source_url cap at plausible. Three
--    orgs with NO source at all count fully — an unknown provenance is not a
--    known-shared one, and every human contribution today has none (0 of
--    146). 631 §1.1 makes source mandatory going forward, which is when this
--    cap starts to bite.
-- 4. §2.4: (b) as the primary path (an explicit admin RPC that writes
--    verified_by_admin without counting) AND (a) as the net (orgs counted on
--    is_test = false only, internal included). Today (b) is the only thing
--    that can move the catalogue; (a) is what lets ablute_/Estojo/Krohnsty
--    agree with each other in the meantime, which is real agreement between
--    real pipelines even if the companies share an owner.

-- ---------------------------------------------------------------- levels
alter table public.catalog_entities
  add column if not exists verified_fields jsonb not null default '{}'::jsonb;

comment on column public.catalog_entities.verified_fields is
  'Prompt 632 §2.3 — per-field verification level: plausible_by_startups < verified_by_startups < verified_by_admin < verified_by_person. Absent key = no recorded level.';

create or replace function public.catalog_verification_rank(p_level text)
returns integer language sql immutable as $$
  select case p_level
    when 'verified_by_person'   then 4
    when 'verified_by_admin'    then 3
    when 'verified_by_startups' then 2
    when 'plausible_by_startups' then 1
    else 0 end;
$$;

-- Contribution field -> catalog_entities column. Null = not a catalogue fact
-- (our_angle, fit_score, hard_filter, last_verified, name…): those stay
-- private to the org and are never candidates for consensus.
create or replace function public.catalog_entity_field_column(p_field text)
returns text language sql immutable as $$
  select case p_field
    when 'invests_in_geographies' then 'geographies'
    when 'website' then 'website' when 'email' then 'email' when 'phone' then 'phone'
    when 'address' then 'address' when 'postal_code' then 'postal_code'
    when 'hq_city' then 'hq_city' when 'hq_country' then 'hq_country'
    when 'sectors' then 'sectors' when 'geographies' then 'geographies'
    when 'stage_min' then 'stage_min' when 'stage_max' then 'stage_max'
    when 'check_min_eur' then 'check_min_eur' when 'check_max_eur' then 'check_max_eur'
    when 'thesis' then 'thesis'
    when 'submission_channel' then 'submission_channel'
    when 'submission_channel_type' then 'submission_channel_type'
    when 'team_page_url' then 'team_page_url'
    when 'key_people' then 'key_people'
    when 'aum' then 'aum' when 'current_funds' then 'current_funds'
    when 'latest_fund' then 'latest_fund' when 'last_investment_found' then 'last_investment_found'
    when 'general_partner_emails' then 'general_partner_emails'
    else null end;
$$;

-- Fields consensus may never auto-apply, whatever the count (decision 1).
create or replace function public.catalog_entity_field_is_admin_only(p_field text)
returns boolean language sql immutable as $$
  select p_field in ('general_partner_emails');
$$;

-- ------------------------------------------------------------ apply field
-- The one writer into catalog_entities for a contributed value. Precedence
-- is enforced HERE, not in the callers, so the trigger and the admin RPC
-- cannot disagree about it. Returns true when it wrote.
create or replace function public.catalog_entity_apply_field(
  p_catalog_id uuid, p_field text, p_value jsonb, p_level text
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_col text;
  v_current_level text;
  v_current_rank int;
  v_existing_blank boolean;
  v_data_type text;
  v_udt text;
  v_text text;
begin
  v_col := public.catalog_entity_field_column(p_field);
  if v_col is null or public.catalog_verification_rank(p_level) = 0 then return false; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then return false; end if;

  select verified_fields ->> p_field into v_current_level from catalog_entities where id = p_catalog_id;
  if not found then return false; end if;

  -- Decision 2: a value the catalogue already holds with no recorded level
  -- ranks as 2. Blank counts as rank 0 whatever the map says.
  execute format('select ($1.%I is null) or (coalesce(nullif(btrim(($1.%I)::text), ''''), ''{}'') = ''{}'') from catalog_entities where id = $2', v_col, v_col)
    into v_existing_blank using (select ce from catalog_entities ce where ce.id = p_catalog_id), p_catalog_id;
  v_current_rank := case
    when v_existing_blank then 0
    when v_current_level is null then 2
    else public.catalog_verification_rank(v_current_level) end;

  if v_current_rank >= public.catalog_verification_rank(p_level) and not v_existing_blank then
    -- Never silently. The blocked attempt is the interesting event.
    insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (auth.uid(), 'catalog_entity_apply_blocked', 'catalog_entity', p_catalog_id,
            jsonb_build_object('field', p_field, 'attempted_level', p_level,
                               'current_level', coalesce(v_current_level, 'unranked_existing_value'), 'value', p_value));
    return false;
  end if;

  select data_type, udt_name into v_data_type, v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'catalog_entities' and column_name = v_col;
  v_text := p_value #>> '{}';

  if v_data_type = 'ARRAY' then
    execute format('update catalog_entities set %I = $1 where id = $2', v_col)
      using (case when jsonb_typeof(p_value) = 'array'
                  then (select array_agg(x) from jsonb_array_elements_text(p_value) x)
                  else array[v_text] end), p_catalog_id;
  elsif v_data_type = 'integer' then
    execute format('update catalog_entities set %I = $1 where id = $2', v_col)
      using nullif(regexp_replace(v_text, '[^0-9]', '', 'g'), '')::integer, p_catalog_id;
  elsif v_data_type = 'USER-DEFINED' then
    -- stage enums: the cast is what validates the value; a bad label lands in
    -- the exception block below rather than in the column.
    execute format('update catalog_entities set %I = $1::%I where id = $2', v_col, v_udt)
      using lower(btrim(v_text)), p_catalog_id;
  else
    execute format('update catalog_entities set %I = $1 where id = $2', v_col)
      using (case when jsonb_typeof(p_value) = 'array'
                  then (select string_agg(x, '; ') from jsonb_array_elements_text(p_value) x)
                  else v_text end), p_catalog_id;
  end if;

  update catalog_entities
     set verified_fields = verified_fields || jsonb_build_object(p_field, p_level)
   where id = p_catalog_id;

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (auth.uid(), 'catalog_entity_field_applied', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', p_level, 'value', p_value,
                             'replaced_level', v_current_level));
  return true;
exception when others then
  -- A bad enum label or a type that would not cast: recorded, never raised —
  -- this runs inside a founder's own insert and must not take it down.
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (auth.uid(), 'catalog_entity_apply_failed', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', p_level, 'value', p_value, 'error', sqlerrm));
  return false;
end $fn$;

revoke all on function public.catalog_entity_apply_field(uuid, text, jsonb, text) from public, anon, authenticated;

-- --------------------------------------------------------------- recount
-- Pure of the trigger so the §2.5 reprocess and any future backfill call the
-- SAME logic rather than a copy of it. Returns what it concluded.
create or replace function public.catalog_entity_recount_consensus(p_catalog_id uuid, p_field text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_best record;
  v_level text;
  v_score int;
  v_consensus_id uuid;
  v_current_score int;
  v_src record;
begin
  if public.catalog_entity_field_column(p_field) is null then return 'ineligible_field'; end if;
  if public.catalog_entity_field_is_admin_only(p_field) then return 'admin_only'; end if;

  -- The value the most distinct orgs agree on, under the per-field
  -- normaliser. Decision 4(a): orgs are counted on is_test = false only.
  select nv, orgs, rows_n, distinct_sources, sample_value
    into v_best
    from (
      select x.nv,
             count(distinct x.org_id) as orgs,
             count(*) as rows_n,
             count(distinct public.normalize_url(x.source_url)) filter (where x.source_url is not null) as distinct_sources,
             (array_agg(x.value order by x.created_at desc))[1] as sample_value
        from (
          select c.org_id, c.value, c.created_at, c.source_url,
                 public.catalog_normalize_for_field(c.field, c.value) as nv
            from contributions c
            join entities e on e.id = c.subject_id
            join orgs o on o.id = c.org_id
           where c.subject_type = 'entity' and c.field = p_field
             and c.status in ('submitted', 'verified')
             and coalesce(o.is_test, false) = false
             and coalesce(e.catalog_id,
                          (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
        ) x
       where x.nv is not null
       group by x.nv
       order by count(distinct x.org_id) desc, count(*) desc
       limit 1
    ) best;
  if v_best is null then return 'no_values'; end if;

  -- Ledger: Engine B's tables, one row per (catalog_id, field), one source
  -- row per org. The panel and the review queue read exactly these.
  insert into catalog_field_consensus (catalog_id, field, value, score)
  values (p_catalog_id, p_field, v_best.sample_value, 0)
  on conflict (catalog_id, field) do update set value = excluded.value, updated_at = now()
  returning id, score into v_consensus_id, v_current_score;

  for v_src in
    select distinct on (c.org_id) c.org_id, c.id as contribution_id, c.value
      from contributions c
      join entities e on e.id = c.subject_id
     where c.subject_type = 'entity' and c.field = p_field and c.status in ('submitted', 'verified')
       and coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
       and public.catalog_normalize_for_field(c.field, c.value) = v_best.nv
     order by c.org_id, c.created_at desc
  loop
    if exists (select 1 from catalog_field_consensus_sources s where s.consensus_id = v_consensus_id and s.org_id = v_src.org_id) then
      update catalog_field_consensus_sources set value = v_src.value, contribution_id = v_src.contribution_id
       where consensus_id = v_consensus_id and org_id = v_src.org_id;
    else
      insert into catalog_field_consensus_sources (consensus_id, org_id, contribution_id, value)
      values (v_consensus_id, v_src.org_id, v_src.contribution_id, v_src.value);
    end if;
  end loop;

  -- A human said no on this row (review route sets -1). Counting does not
  -- override a person; it is recorded and left alone.
  if v_current_score < 0 then return 'rejected_by_review'; end if;

  -- §2.3 levels, with §3.1's cap (decision 3).
  v_level := case
    when v_best.orgs >= 3 and v_best.distinct_sources <> 1 then 'verified_by_startups'
    when v_best.orgs >= 2 then 'plausible_by_startups'
    else null end;
  if v_level is null then return 'pending_1_org'; end if;

  -- Engine B's score scale, so consensusVisibility() reads the same truth:
  -- 2 = community/plausible, 8 = verified. Never lowered here — votes do that.
  v_score := case v_level when 'verified_by_startups' then 8 else 2 end;
  if v_score > v_current_score then
    update catalog_field_consensus set score = v_score, updated_at = now() where id = v_consensus_id;
  end if;

  if v_level = 'verified_by_startups' then
    update contributions c
       set status = 'verified', reviewed_at = now(),
           reviewer_notes = trim(both ' · ' from coalesce(c.reviewer_notes || ' · ', '') || 'Auto-verified: ' || v_best.orgs || ' startups agree.')
      from entities e
     where e.id = c.subject_id and c.subject_type = 'entity' and c.field = p_field and c.status = 'submitted'
       and coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
       and public.catalog_normalize_for_field(c.field, c.value) = v_best.nv;
  end if;

  perform public.catalog_entity_apply_field(p_catalog_id, p_field, v_best.sample_value, v_level);

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_entity_consensus', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', v_level, 'org_count', v_best.orgs,
                             'distinct_sources', v_best.distinct_sources, 'value', v_best.sample_value));
  return v_level;
end $fn$;

revoke all on function public.catalog_entity_recount_consensus(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- trigger
create or replace function public.catalog_entity_contribution_consensus()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_catalog uuid;
begin
  if new.subject_type <> 'entity' or new.status not in ('submitted', 'verified') then return new; end if;
  select coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1))
    into v_catalog from entities e where e.id = new.subject_id;
  if v_catalog is null then return new; end if;
  perform public.catalog_entity_recount_consensus(v_catalog, new.field);
  return new;
exception when others then
  -- The founder's own "+ Add info" must never fail because the catalogue
  -- could not be updated. Recorded, not raised.
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_entity_consensus_error', 'contribution', new.id,
          jsonb_build_object('field', new.field, 'error', sqlerrm));
  return new;
end $fn$;

drop trigger if exists trg_catalog_entity_consensus on public.contributions;
create trigger trg_catalog_entity_consensus
  after insert on public.contributions
  for each row execute function public.catalog_entity_contribution_consensus();

-- ------------------------------------------------------ the admin path (b)
-- "Quando uma conta developer/admin escreve, é verdade directa." An explicit
-- door, not an exception buried in the count.
create or replace function public.catalog_entity_admin_set_field(p_catalog_id uuid, p_field text, p_value jsonb)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return public.catalog_entity_apply_field(p_catalog_id, p_field, p_value, 'verified_by_admin');
end $fn$;

revoke all on function public.catalog_entity_admin_set_field(uuid, text, jsonb) from public, anon;
grant execute on function public.catalog_entity_admin_set_field(uuid, text, jsonb) to authenticated, service_role;

comment on function public.catalog_entity_admin_set_field(uuid, text, jsonb) is
  'Prompt 632 §2.3 — a platform admin writes the catalogue directly at verified_by_admin. Only verified_by_person outranks it.';
