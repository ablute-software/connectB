-- Prompt 635 — the four decisions ratified, the tie settled, and the door
-- closed: "3 startups agree" must never be one person agreeing with
-- themselves across orgs they own.
--
-- §2 — THE DOOR. Scoring orgs today are ablute_, Estojo, Sherlock Deal and
-- Krohnsty: all is_internal, all Nuno's. With internal orgs counting (632
-- §2.4 (a), ratified in 635 §1.4), three contributions from three of them
-- would write the catalogue as `verified_by_startups` with the note
-- "Auto-verified: 3 startups agree." A true statement about orgs and a false
-- one about independence — and the label is the product. So the threshold
-- now needs BOTH: n distinct orgs AND n distinct authors. Measured today:
-- seven users, seven orgs, nobody in two — the door was open and unused.
--
-- The honest limit of this rule, stated so nobody relies on more than it
-- gives: it counts distinct user ACCOUNTS. One person with a different
-- account per org still passes. Detecting shared ownership across accounts
-- is a different feature; this one stops the same account counting twice.
--
-- A consequence for existing rows: only 13 of 146 human contributions carry
-- an author (Prompt 572 fixed the write path; the older rows never had one)
-- and 0 of 608 AI rows do. Rows without an author count toward orgs but not
-- toward authors, so they can no longer reach a level on their own. That is
-- the right reading: three AI runs over the same fund page are one
-- observation, and a human row with no author is one we cannot vouch for.
-- The §2.5 reprocess already showed 0 promotable pairs, so nothing is lost.
--
-- §1.2 — THE TIE, decided by date as recommended, and written here so it is
-- never discovered in production. An existing catalogue value with no
-- recorded level ranks as 2 (it came from the fund's own page, read
-- literally). Against a 3-org consensus, also rank 2:
--   · the consensus wins if its OLDEST agreeing contribution is newer than
--     the entity's enriched_at (created_at when never enriched) — three
--     founders who just got a bounce know more than a page read months ago;
--   · the existing value holds otherwise — three founders reading the same
--     stale aggregator do not outrank the official page;
--   · both outcomes are audited.
-- Between RECORDED levels, equal rank now allows the write: a re-run
-- consensus reflects the current count, an admin correcting an admin value
-- is legitimate, and a person re-confirming their own record is too. Lower
-- rank still never overwrites higher.
--
-- §1.3 — THE SAME-SOURCE CAP. Unchanged today: three orgs citing one shared
-- source_url cap at plausible; three with NO source count fully, because
-- every human contribution today has none and the engine would otherwise
-- be born inert again. THIS RULE MUST INVERT WHEN 631 §1.1 (source required
-- at the form) HAS LANDED — from then on, contributions without a source
-- count as ONE, exactly like ones sharing a URL. Three people looking at an
-- identifiable source are more verifiable than three with no source at all;
-- the current rule is a bridge, not a position. The line to change is
-- marked INVERT-AFTER-631 below.
--
-- §1.1 — a firm's e-mail, phone and address stay eligible; anything that
-- identifies a PERSON stays admin-only (general_partner_emails today; the
-- helper is the one place to add to).
--
-- Also: an admin who edits the catalogue dossier directly needs their write
-- STAMPED, or the date rule above could let a later consensus overwrite it
-- (an unstamped value ranks 2, not 3). catalog_entity_stamp_admin_verified
-- is what the dossier PATCH route now calls.

-- The signature gains an argument; the old one must go or every 4-argument
-- call becomes ambiguous.
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

  execute format('select ($1.%I is null) or (coalesce(nullif(btrim(($1.%I)::text), ''''), ''{}'') = ''{}'') from catalog_entities where id = $2', v_col, v_col)
    into v_existing_blank using (select ce from catalog_entities ce where ce.id = p_catalog_id), p_catalog_id;

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
  v_effective int;
begin
  if public.catalog_entity_field_column(p_field) is null then return 'ineligible_field'; end if;
  if public.catalog_entity_field_is_admin_only(p_field) then return 'admin_only'; end if;

  select nv, orgs, authors, rows_n, distinct_sources, sample_value, first_seen
    into v_best
    from (
      select x.nv,
             count(distinct x.org_id) as orgs,
             -- Prompt 635 §2: independence is people, not only orgs. Null
             -- authors (AI rows, pre-572 human rows) count for nothing here.
             count(distinct x.author_user_id) as authors,
             count(*) as rows_n,
             -- INVERT-AFTER-631: today only a SHARED url counts as one source;
             -- rows with no source are counted as independent. Once the form
             -- requires a source, change this so that null sources also
             -- collapse to one — see the header.
             count(distinct public.normalize_url(x.source_url)) filter (where x.source_url is not null) as distinct_sources,
             (array_agg(x.value order by x.created_at desc))[1] as sample_value,
             min(x.created_at) as first_seen
        from (
          select c.org_id, c.author_user_id, c.value, c.created_at, c.source_url,
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
       order by least(count(distinct x.org_id), count(distinct x.author_user_id)) desc, count(distinct x.org_id) desc, count(*) desc
       limit 1
    ) best;
  if v_best is null then return 'no_values'; end if;

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

  if v_current_score < 0 then return 'rejected_by_review'; end if;

  -- Prompt 635 §2: n orgs AND n people.
  v_effective := least(v_best.orgs, v_best.authors);
  v_level := case
    when v_effective >= 3 and v_best.distinct_sources <> 1 then 'verified_by_startups'
    when v_effective >= 2 then 'plausible_by_startups'
    else null end;
  if v_level is null then return case when v_best.orgs >= 2 then 'pending_orgs_' || v_best.orgs || '_authors_' || v_best.authors else 'pending_1_org' end; end if;

  v_score := case v_level when 'verified_by_startups' then 8 else 2 end;
  if v_score > v_current_score then
    update catalog_field_consensus set score = v_score, updated_at = now() where id = v_consensus_id;
  end if;

  if v_level = 'verified_by_startups' then
    update contributions c
       set status = 'verified', reviewed_at = now(),
           reviewer_notes = trim(both ' · ' from coalesce(c.reviewer_notes || ' · ', '') || 'Auto-verified: ' || v_effective || ' startups agree.')
      from entities e
     where e.id = c.subject_id and c.subject_type = 'entity' and c.field = p_field and c.status = 'submitted'
       and coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
       and public.catalog_normalize_for_field(c.field, c.value) = v_best.nv;
  end if;

  perform public.catalog_entity_apply_field(p_catalog_id, p_field, v_best.sample_value, v_level, v_best.first_seen);

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_entity_consensus', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', v_level, 'org_count', v_best.orgs, 'author_count', v_best.authors,
                             'distinct_sources', v_best.distinct_sources, 'first_seen', v_best.first_seen, 'value', v_best.sample_value));
  return v_level;
end $fn$;

revoke all on function public.catalog_entity_recount_consensus(uuid, text) from public, anon, authenticated;

-- The stamp for direct admin edits (dossier PATCH route). Levels only; the
-- values were already written by the route through the ordinary column
-- path, and this records that an admin stands behind them.
create or replace function public.catalog_entity_stamp_admin_verified(p_catalog_id uuid, p_fields text[])
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_f text;
  v_n int := 0;
  v_stamp jsonb := '{}'::jsonb;
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  foreach v_f in array coalesce(p_fields, '{}') loop
    if public.catalog_entity_field_column(v_f) is not null then
      v_stamp := v_stamp || jsonb_build_object(v_f, 'verified_by_admin');
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    update catalog_entities set verified_fields = verified_fields || v_stamp where id = p_catalog_id;
    insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (auth.uid(), 'catalog_entity_admin_stamped', 'catalog_entity', p_catalog_id, jsonb_build_object('fields', p_fields));
  end if;
  return v_n;
end $fn$;

revoke all on function public.catalog_entity_stamp_admin_verified(uuid, text[]) from public, anon;
grant execute on function public.catalog_entity_stamp_admin_verified(uuid, text[]) to authenticated, service_role;
