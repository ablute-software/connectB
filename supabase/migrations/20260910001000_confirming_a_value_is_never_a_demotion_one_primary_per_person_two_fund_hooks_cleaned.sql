-- Prompt 643 §1, §2, §3 and Prompt 642 §3.4.
--
-- §1 — CONFIRMING THE SAME VALUE IS NEVER A DEMOTION. H14 was the 35th
-- entity of the 640 import with an empty verified_fields: it is "Confiança:
-- Média" in the file (plausible_by_startups, rank 1), every one of its seven
-- fields already had a value with no level, and the ladder in
-- catalog_entity_apply_field never lets rank 1 touch an unranked value — so
-- all seven were blocked, including an email (amministrazione@h14.it) that
-- was IDENTICAL to the one on the row. A confirmation of the same value
-- changes nothing in the column; it only raises the label from "nothing"
-- to "plausible". Both apply_field functions now compare the normalised
-- incoming value with the normalised existing one and, when equal, stamp
-- the level (never lowering an existing one), audit reason
-- 'confirmed_existing', and write no column. The importer is idempotent,
-- so running it again stamps H14's email.
--
-- §2 — ONE PRIMARY PER PERSON. 33 people carried two (Pedro Bandeira three)
-- is_primary affiliations after the import — Hugo Gonçalves Pereira among
-- them, President at Investors Portugal and Founder/Venture Partner at
-- Shilling. Two real consequences, not cosmetic: catalog_person_apply_field
-- writes a 'role' to EVERY primary row, so one contribution would give him
-- the same title at both firms; and enqueue_cold_person_batch joins on
-- is_primary, so he counted twice against the limit and the unique_violation
-- swallowed the second — the batch delivered fewer than fifty with nobody
-- noticing. One primary is chosen per person (current first, then the most
-- recent start or creation, then the best seniority rank); a partial unique
-- index makes a second one impossible; a BEFORE trigger turns any insert
-- that asks for a primary the person already has into a non-primary, and
-- turns an explicit promotion into a demotion of the others, so every
-- writer — the importer, contribute_catalog_person, the worker, an admin —
-- is covered without each having to remember. Legitimate double
-- affiliations (Hugo, Pedro Ramalho Carlos, Joaquim Sérvulo Rodrigues) keep
-- both rows; only one is primary.
--
-- §3 — TWO FUND-SHAPED HOOKS OUT OF THE CATALOGUE. Rui Rodrigues ("Indico
-- Capital Partners launched a €50 million Blue Economy fund … with Rui
-- Rodrigues as a Partner involved") and João Trigo da Roza ("Co-president
-- of Investors Portugal, which manages approximately €500 million…") are
-- the fund as grammatical subject with the person in a complement — the
-- shape 641 §2 named and worker v33's positional rules now reject (both
-- sentences are negative fixtures in src/lib/hook-rules.test.ts). Same
-- treatment as Alpana: hook null, none_found, an audit row with the text.
--
-- 642 §3.4 — the classifier learns a receptionist is rank 9, not "unknown"
-- (which orders as 5, above the board).

-- ------------------------------------------------------- §1 entities
drop function if exists public.catalog_entity_apply_field(uuid, text, jsonb, text);

create or replace function public.catalog_entity_apply_field(
  p_catalog_id uuid, p_field text, p_value jsonb, p_level text, p_evidence_at timestamptz default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_col text;
  v_current_level text;
  v_incoming_rank int;
  v_existing_blank boolean;
  v_existing_json jsonb;
  v_existing_dated timestamptz;
  v_allow boolean := false;
  v_why text;
  v_data_type text;
  v_udt text;
  v_text text;
begin
  v_col := public.catalog_entity_field_column(p_field);
  v_incoming_rank := public.catalog_verification_rank(p_level);
  if v_col is null or v_incoming_rank = 0 then return false; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then return false; end if;

  select verified_fields ->> p_field, coalesce(enriched_at, created_at)
    into v_current_level, v_existing_dated
    from catalog_entities where id = p_catalog_id;
  if not found then return false; end if;

  execute format('select ($1.%I is null) or (coalesce(nullif(btrim(($1.%I)::text), ''''), ''{}'') = ''{}''), to_jsonb($1.%I) from catalog_entities where id = $2', v_col, v_col, v_col)
    into v_existing_blank, v_existing_json using (select ce from catalog_entities ce where ce.id = p_catalog_id), p_catalog_id;

  -- Prompt 643 §1 — the same value again is a confirmation, not a write.
  if not v_existing_blank and (
       p_value = v_existing_json
       or public.catalog_normalize_for_field(p_field, p_value) is not distinct from public.catalog_normalize_for_field(p_field, v_existing_json)
     ) then
    if v_current_level is null or v_incoming_rank > public.catalog_verification_rank(v_current_level) then
      update catalog_entities set verified_fields = verified_fields || jsonb_build_object(p_field, p_level) where id = p_catalog_id;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (auth.uid(), 'catalog_entity_field_confirmed', 'catalog_entity', p_catalog_id,
              jsonb_build_object('field', p_field, 'level', p_level, 'reason', 'confirmed_existing', 'replaced_level', v_current_level, 'value', p_value, 'evidence_at', p_evidence_at));
    end if;
    return true;
  end if;

  if v_existing_blank then
    v_allow := true; v_why := 'blank';
  elsif v_current_level is null then
    -- Prompt 635 §1.2: an unranked catalogue value ranks 2.
    if v_incoming_rank > 2 then
      v_allow := true; v_why := 'outranks_unranked_existing';
    elsif v_incoming_rank = 2 and p_evidence_at is not null and p_evidence_at > v_existing_dated then
      v_allow := true; v_why := 'stale_catalog_value_replaced';
    else
      v_allow := false; v_why := case when v_incoming_rank = 2 then 'existing_value_is_newer_or_undated_evidence' else 'unranked_existing_value_outranks' end;
    end if;
  elsif v_incoming_rank >= public.catalog_verification_rank(v_current_level) then
    v_allow := true; v_why := case when v_incoming_rank = public.catalog_verification_rank(v_current_level) then 'equal_rank_current_wins' else 'outranks' end;
  else
    v_allow := false; v_why := 'lower_rank';
  end if;

  if not v_allow then
    insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (auth.uid(), 'catalog_entity_apply_blocked', 'catalog_entity', p_catalog_id,
            jsonb_build_object('field', p_field, 'attempted_level', p_level, 'reason', v_why,
                               'current_level', coalesce(v_current_level, 'unranked_existing_value'),
                               'existing_dated', v_existing_dated, 'evidence_at', p_evidence_at, 'value', p_value));
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
          jsonb_build_object('field', p_field, 'level', p_level, 'reason', v_why, 'value', p_value,
                             'replaced_level', v_current_level, 'existing_dated', v_existing_dated, 'evidence_at', p_evidence_at));
  return true;
exception when others then
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (auth.uid(), 'catalog_entity_apply_failed', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', p_level, 'value', p_value, 'error', sqlerrm));
  return false;
end $fn$;

revoke all on function public.catalog_entity_apply_field(uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;

-- --------------------------------------------------------- §1 people
-- The people mirror never had a ladder: it wrote unconditionally. It keeps
-- doing so for a NEW value; for the SAME value it now stamps (never lowering
-- an existing level), audits 'confirmed_existing', and touches no column.
-- 'role' writes to the primary affiliation, of which there is now one (§2).
create or replace function public.catalog_person_apply_field(p_person_id uuid, p_field text, p_value jsonb, p_level text)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_text text := p_value #>> '{}';
  v_words text[];
  v_rowcount int;
  v_current jsonb;
  v_current_level text;
begin
  insert into catalog_people_research (person_id) values (p_person_id)
    on conflict (person_id) do nothing;

  -- Prompt 643 §1 — what is there now, in the same shape the contribution carries.
  if p_field = 'role' then
    select to_jsonb(a.title) into v_current from catalog_person_affiliations a where a.person_id = p_person_id and a.is_primary limit 1;
  elsif p_field = 'based_in' then
    select to_jsonb(p.based_in) into v_current from catalog_people p where p.id = p_person_id;
  elsif p_field = 'linkedin_url' then
    select to_jsonb(p.linkedin_url) into v_current from catalog_people p where p.id = p_person_id;
  elsif p_field = 'kill_words' then
    select to_jsonb(r.kill_words) into v_current from catalog_people_research r where r.person_id = p_person_id;
  elsif p_field in ('background', 'hook', 'watch_outs', 'intro_path', 'email_guess') then
    execute format('select to_jsonb(%I) from catalog_people_research where person_id = $1', p_field) into v_current using p_person_id;
  else
    return;
  end if;
  select verified_fields ->> p_field into v_current_level from catalog_people_research where person_id = p_person_id;

  if v_current is not null and jsonb_typeof(v_current) <> 'null'
     and (v_current = p_value or public.catalog_person_normalize_value(p_value) is not distinct from public.catalog_person_normalize_value(v_current)) then
    if v_current_level is null or public.catalog_verification_rank(p_level) > public.catalog_verification_rank(v_current_level) then
      update catalog_people_research set verified_fields = verified_fields || jsonb_build_object(p_field, p_level) where person_id = p_person_id;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (auth.uid(), 'catalog_person_field_confirmed', 'catalog_person', p_person_id,
              jsonb_build_object('field', p_field, 'level', p_level, 'reason', 'confirmed_existing', 'replaced_level', v_current_level, 'value', p_value));
    end if;
    return;
  end if;

  if p_field = 'role' then
    update catalog_person_affiliations set title = v_text
      where person_id = p_person_id and is_primary = true;
    get diagnostics v_rowcount = row_count;
    if v_rowcount = 0 then return; end if;
  elsif p_field = 'based_in' then
    update catalog_people set based_in = v_text where id = p_person_id;
  elsif p_field = 'linkedin_url' then
    update catalog_people set linkedin_url = v_text where id = p_person_id;
  elsif p_field = 'kill_words' then
    v_words := array(select jsonb_array_elements_text(p_value));
    update catalog_people_research set kill_words = v_words where person_id = p_person_id;
  else
    execute format('update catalog_people_research set %I = $1 where person_id = $2', p_field)
      using v_text, p_person_id;
  end if;

  update catalog_people_research
    set verified_fields = verified_fields || jsonb_build_object(p_field, p_level)
    where person_id = p_person_id;
end $fn$;

-- ------------------------------------------------- §2 one primary each
do $$
declare
  v_demoted int;
begin
  with ranked as (
    select id, person_id,
           row_number() over (partition by person_id
                              order by current desc, coalesce(started_at, created_at::date) desc, seniority_rank asc nulls last, created_at desc) as rn
      from public.catalog_person_affiliations
     where is_primary
  ),
  demoted as (
    update public.catalog_person_affiliations a
       set is_primary = false
      from ranked r
     where r.id = a.id and r.rn > 1
    returning a.id, a.person_id, a.entity_id
  )
  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  select null, 'affiliation_primary_demoted', 'catalog_person', d.person_id,
         jsonb_build_object('prompt', 643, 'affiliation_id', d.id, 'entity_id', d.entity_id, 'reason', 'one primary per person')
    from demoted d;
  get diagnostics v_demoted = row_count;
  raise notice 'demoted % secondary primaries', v_demoted;
end $$;

create unique index if not exists catalog_person_affiliations_one_primary
  on public.catalog_person_affiliations (person_id) where is_primary;

create or replace function public.catalog_person_affiliations_one_primary()
returns trigger language plpgsql as $fn$
begin
  if new.is_primary then
    if tg_op = 'INSERT' then
      if exists (select 1 from public.catalog_person_affiliations x where x.person_id = new.person_id and x.is_primary) then
        new.is_primary := false;
      end if;
    elsif not old.is_primary then
      update public.catalog_person_affiliations set is_primary = false
       where person_id = new.person_id and is_primary and id <> new.id;
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_catalog_person_affiliations_one_primary on public.catalog_person_affiliations;
create trigger trg_catalog_person_affiliations_one_primary
  before insert or update of is_primary on public.catalog_person_affiliations
  for each row execute function public.catalog_person_affiliations_one_primary();

-- 643 §2(c): the writer says it explicitly too, so the intent is in the code and not only in the trigger.
create or replace function public.contribute_catalog_person(p_org_id uuid, p_user_id uuid, p_catalog_entity_id uuid, p_full_name text, p_source_url text, p_title text default null::text, p_points integer default 0, p_validated_fields jsonb default '[]'::jsonb, p_detected_language text default null::text, p_original_title text default null::text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_person_id uuid;
  v_name text := btrim(p_full_name);
  v_batch text := 'founder_contribution:' || gen_random_uuid()::text;
  v_notes text;
begin
  if v_name is null or v_name = '' then
    raise exception 'contribute_catalog_person: full_name is required';
  end if;
  if p_source_url is null or btrim(p_source_url) = '' then
    raise exception 'contribute_catalog_person: source_url is required';
  end if;

  if not exists (
    select 1 from public.catalog_deliveries cd
     where cd.catalog_id = p_catalog_entity_id and cd.org_id = p_org_id
  ) then
    raise exception 'contribute_catalog_person: org % does not have catalog entity % in its pipeline',
      p_org_id, p_catalog_entity_id
      using errcode = 'insufficient_privilege';
  end if;

  select cp.id into v_person_id
    from public.catalog_people cp
    join public.catalog_person_affiliations cpa on cpa.person_id = cp.id
   where cpa.entity_id = p_catalog_entity_id
     and lower(btrim(cp.full_name)) = lower(v_name)
   order by cp.created_at
   limit 1;

  if v_person_id is null then
    insert into public.catalog_people (full_name, entity_id, hook_status, enrichment_status)
      values (v_name, p_catalog_entity_id, 'to_research', 'pending')
      returning id into v_person_id;
  end if;

  -- Prompt 643 §2(c): primary only when the person has none.
  insert into public.catalog_person_affiliations (person_id, entity_id, title, kind, current, is_primary)
    values (v_person_id, p_catalog_entity_id, p_title, 'other', true,
            not exists (select 1 from public.catalog_person_affiliations x where x.person_id = v_person_id and x.is_primary))
  on conflict (person_id, entity_id, kind) do update
    set title = coalesce(excluded.title, public.catalog_person_affiliations.title),
        current = true;

  v_notes := 'Founder contribution, AI-validated (Prompt 507). Validated fields: '
    || coalesce(p_validated_fields::text, '[]')
    || case when p_detected_language is not null then '. Source language: ' || p_detected_language else '' end
    || case when p_original_title is not null then '. Original title: ' || p_original_title else '' end;

  insert into public.catalog_entity_enrichment_sources (
    entity_id, person_id, source_url, source_type, verified_at, supports, quality, notes,
    batch_id, contributed_by_org_id, contributed_by_user_id
  ) values (
    p_catalog_entity_id, v_person_id, btrim(p_source_url), 'founder_contribution', current_date,
    'person_affiliation', 'ai_validated', v_notes,
    v_batch, p_org_id, p_user_id
  );

  if p_points > 0 then
    insert into public.contribution_points (
      org_id, awarded_to_user_id, points, reason, catalog_entity_id, catalog_person_id, source_url, detail
    ) values (
      p_org_id, p_user_id, p_points, 'catalog_person_contribution',
      p_catalog_entity_id, v_person_id, btrim(p_source_url),
      jsonb_build_object('validated_fields', p_validated_fields, 'detected_language', p_detected_language)
    );
  end if;

  return jsonb_build_object(
    'person_id', v_person_id,
    'points_awarded', p_points,
    'balance', (select coalesce(sum(points), 0) from public.contribution_points where org_id = p_org_id)
  );
end;
$function$;

-- ------------------------------------------------ §3 two hooks cleaned
update public.catalog_people_research
   set hook = null, hook_source = null, updated_at = now()
 where person_id in ('0bab99d4-0ce0-4108-a916-20f9cd11df7d', '25aca0c6-4faf-4d5f-96b4-f6d04e0377bc')
   and hook_source = 'web';

update public.catalog_people set hook_status = 'none_found', updated_at = now()
 where id in ('0bab99d4-0ce0-4108-a916-20f9cd11df7d', '25aca0c6-4faf-4d5f-96b4-f6d04e0377bc');

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values
  (null, 'hook_about_fund_not_person', 'catalog_person', '0bab99d4-0ce0-4108-a916-20f9cd11df7d',
   jsonb_build_object('path', 'manual', 'rule', 'starts_with_entity', 'entity_mention', 'indico capital partners',
                      'hook', 'Indico Capital Partners launched a €50 million Blue Economy fund focused on ocean-related startups and climate action, with Rui Rodrigues as a Partner involved in this ocean tech investment strategy alongside AI, Deep Tech, SaaS, FinTech, IoT, and SpaceTech investments.',
                      'note', 'Prompt 643 §3 / 641 §2 — the fund as grammatical subject; negative fixture in hook-rules.test.ts')),
  (null, 'hook_about_fund_not_person', 'catalog_person', '25aca0c6-4faf-4d5f-96b4-f6d04e0377bc',
   jsonb_build_object('path', 'manual', 'rule', 'relative_clause', 'entity_mention', 'investors portugal',
                      'hook', 'Co-president of Investors Portugal, which manages approximately €500 million in assets under management with €150 million planned investment over three years, supporting around 425 business angels and 300+ invested startups. Publicly advocates for building high-value-added businesses to address Portugal''s economic stagnation and create qualified employment with higher salaries.',
                      'note', 'Prompt 643 §3 / 641 §2 — a relative clause hanging off the entity; negative fixture in hook-rules.test.ts'));

-- ------------------------------------------- 642 §3.4 classifier v5
create or replace function public.catalog_seniority_rank_from_title(p_title text)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_title is null or btrim(p_title) = '' then null
    when p_title ~* 'non[\s-]?executive|independent\s+director|investor\s+relations' then 9
    when p_title ~* 'vice[\s-]?president|venture\s+partner|founder''?s\s+(associate|office)' then 3
    when p_title ~* '(founding|managing|general)\s+partner' then 1
    when p_title ~* '\yceo\y|chief\s+executive|managing\s+director|\yfounder\y|founding|\ypresident\y|gesch(ä|a)ftsf(ü|u)hrer|bestuurder' then 1
    when p_title ~* 'chief\s+investment|investment\s+director|investeringsdirekt|executive\s+director|portfolio\s+director|beteiligungsmanager|head\s+of\s+venture\s+capital' then 2
    when p_title ~* 'partner|principal' then 2
    when p_title ~* 'investment\s+manager|associate' then 3
    when p_title ~* 'investment\s+team|\yinvestments\y|\yinvestor\y|investeerder|investment\s+(professional|executive)|portfolio\s+manager|fund\s+manager|investment\s+committee|\yic\y|\yac\s+member|impact\s+manager' then 3
    when p_title ~* '\yanalyst\y' then 4
    when p_title ~* '\ychair(man|woman|person)?\y|chief\s+of\s+staff|cfo|coo|chief\s+(financial|operating)|legal|compliance|general counsel|\yit\y|information technology|marketing|platform|office manager|executive assistant|\yassistant\y|board|supervisory|\yadvisor\y|reception|recepcion|front\s+desk|secretar' then 9
    when p_title ~* '\yfinance\y|financial|controller|accountant|communications|business\s+development|\yoperations\y|client\s+services' then 9
    else null
  end;
$$;

update public.catalog_person_affiliations
   set seniority_rank = 9
 where seniority_rank is null and title ~* 'reception|recepcion|front\s+desk|secretar';
