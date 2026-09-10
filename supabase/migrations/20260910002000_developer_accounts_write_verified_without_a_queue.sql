-- Prompt 642 §1, §2.1, §2.2, §2.3, §3.1, §3.2, §3.3 — the developer account
-- writes verified, without a queue, through every door a developer actually
-- writes through.
--
-- Nuno's rule, in his words: "dados de enriquecimento de VC e pessoas, feito
-- pelos developers da sherlock (…) passam todas a ser incorporadas como
-- verdadeiras/autenticas e verificadas, sem quarentena". 632 §2.3 said so;
-- 635 wired it only to the back-office approve click and the catalogue
-- dossier PATCH. Measured on 2026-09-09: none of the doors a developer
-- really uses consulted is_platform_admin() — the "+ Add info" form wrote
-- free-text field names the consensus called ineligible; a dossier edit
-- generated no contribution at all (the 07-22 mechanism disappeared); a
-- person edit from Team fed a consensus that counts external orgs only, so
-- ablute_'s edits counted zero forever; and there was no people mirror of
-- catalog_entity_admin_set_field.
--
-- §1 THE PREDICATE, a security decision: developer = is_platform_admin()
-- evaluated on auth.uid() AT WRITE TIME. Never the stored author_user_id
-- (the client writes whatever it likes there and an admin's uuid is no
-- secret); never service_role (the worker's writes are AI, never
-- verified_by_admin). platform_admins is the allowlist; adding a developer
-- is one row, never a rule by e-mail domain. Level verified_by_admin (rank
-- 3): below the investor's own word, above every startup. No queue is not
-- no record: the contributions row is still written — it is the ledger —
-- but is born or becomes 'verified' with reviewed_by = auth.uid().
--
-- §2.1 "+ Add info": the consensus trigger applies an admin's mapped field
-- at verified_by_admin and marks the row verified; a free-text field from an
-- admin has no column to go to and stays 'submitted' with a note that says
-- "place by hand" (631 §1's mandatory field selector ends that branch).
-- §2.2 The dossier: an AFTER UPDATE trigger on entities turns every changed
-- catalogue column into a contributions row — the admin's are verified and
-- applied at once, a founder's go through consensus — which is exactly the
-- founder rule ("sempre que um founder preenche dados fica suspensa a
-- entrada no catálogo") that nothing had been feeding since 07-24.
-- §2.3 linkedin_url on catalog_entities and entities: the company page is
-- neither website nor team_page_url.
-- §3.1 catalog_person_admin_set_field, the people mirror. §3.2 the Team
-- trigger routes an admin's edits through it. §3.3 contribute_catalog_person
-- gets an admin branch: no delivery check, source optional, manual/recorded
-- provenance, role stamped, kind from the title.

-- ------------------------------------------------------- §2.3 column
alter table public.catalog_entities add column if not exists linkedin_url text;
alter table public.entities add column if not exists linkedin_url text;
comment on column public.catalog_entities.linkedin_url is 'Prompt 642 §2.3 — the firm''s LinkedIn company page. Never a website, never a team page.';

create or replace function public.catalog_entity_field_column(p_field text)
returns text language sql immutable as $function$
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
    when 'linkedin_url' then 'linkedin_url'
    when 'key_people' then 'key_people'
    when 'aum' then 'aum' when 'current_funds' then 'current_funds'
    when 'latest_fund' then 'latest_fund' when 'last_investment_found' then 'last_investment_found'
    when 'general_partner_emails' then 'general_partner_emails'
    else null end;
$function$;

-- ------------------------------------------------ §1 + §2.1 the trigger
create or replace function public.catalog_entity_contribution_consensus()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_catalog uuid;
  v_admin boolean;
begin
  if new.subject_type <> 'entity' or new.status not in ('submitted', 'verified') then return new; end if;
  select coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1))
    into v_catalog from entities e where e.id = new.subject_id;
  if v_catalog is null then return new; end if;

  -- Prompt 642 §1 — the JWT decides who is a developer, not the row.
  v_admin := new.source = 'user' and auth.uid() is not null and public.is_platform_admin();
  if v_admin and new.status = 'submitted' then
    if public.catalog_entity_field_column(new.field) is not null then
      perform public.catalog_entity_apply_field(v_catalog, new.field, new.value, 'verified_by_admin', new.created_at);
      update contributions
         set status = 'verified', reviewed_by = auth.uid(), reviewed_at = now(),
             reviewer_notes = 'Conta developer — verificado na escrita (Prompt 642)'
       where id = new.id;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (auth.uid(), 'catalog_entity_admin_write', 'catalog_entity', v_catalog,
              jsonb_build_object('field', new.field, 'value', new.value, 'contribution_id', new.id));
    else
      -- A free-text field from an admin: nothing to apply it to. Stays in the
      -- ledger as 'submitted' with a note that says so; 631 §1's field
      -- selector removes this branch's new entries.
      update contributions
         set reviewer_notes = 'Conta developer — campo livre sem coluna de catálogo; colocar à mão (Prompt 642 §2.1)'
       where id = new.id;
    end if;
    return new;
  end if;

  perform public.catalog_entity_recount_consensus(v_catalog, new.field);
  return new;
exception when others then
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_entity_consensus_error', 'contribution', new.id,
          jsonb_build_object('field', new.field, 'error', sqlerrm));
  return new;
end $function$;

-- ------------------------------------------------- §3.1 people mirror
create or replace function public.catalog_person_admin_set_field(p_person_id uuid, p_field text, p_value jsonb, p_org_id uuid default null)
returns boolean
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_field not in ('role', 'based_in', 'linkedin_url', 'kill_words', 'background', 'hook', 'watch_outs', 'intro_path', 'email_guess') then
    return false;
  end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then return false; end if;

  -- linkedin_url and email_guess are admin-only in the consensus precisely
  -- because only an admin should write them; here the admin does.
  perform public.catalog_person_apply_field(p_person_id, p_field, p_value, 'verified_by_admin');

  -- The ledger row, verified at birth (642 §1). Needs an org: the caller's,
  -- else the admin's own membership; an admin with neither still audits.
  v_org := coalesce(p_org_id, (select om.org_id from org_members om where om.user_id = v_uid limit 1));
  if v_org is not null and v_uid is not null then
    insert into contributions (subject_type, subject_id, org_id, author_user_id, field, value, status, source, kind, reviewed_by, reviewed_at, reviewer_notes, created_at)
    values ('catalog_person', p_person_id, v_org, v_uid, p_field, p_value, 'verified', 'user', 'fill', v_uid, now(), 'Conta developer — verificado na escrita (Prompt 642)', now())
    on conflict (subject_id, org_id, field) where subject_type = 'catalog_person'
    do update set value = excluded.value, author_user_id = excluded.author_user_id, status = 'verified',
                  reviewed_by = excluded.reviewed_by, reviewed_at = now(), reviewer_notes = excluded.reviewer_notes, created_at = now();
  end if;

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (v_uid, 'catalog_person_admin_write', 'catalog_person', p_person_id,
          jsonb_build_object('field', p_field, 'value', p_value, 'org_id', v_org));
  return true;
end $fn$;

revoke all on function public.catalog_person_admin_set_field(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.catalog_person_admin_set_field(uuid, text, jsonb, uuid) to authenticated, service_role;

-- --------------------------------------------- §3.2 the Team trigger
create or replace function public.people_contribute_to_catalog()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_admin boolean;
begin
  if new.catalog_person_id is null then return new; end if;
  if auth.uid() is null then return new; end if;
  -- Prompt 642 §3.2 — an admin's edit is a verified write; a founder's is a contribution.
  v_admin := public.is_platform_admin();

  if new.role is distinct from old.role and coalesce(btrim(new.role), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'role', to_jsonb(new.role), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'role', to_jsonb(new.role)); end if;
  end if;
  if new.based_in is distinct from old.based_in and coalesce(btrim(new.based_in), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'based_in', to_jsonb(new.based_in), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'based_in', to_jsonb(new.based_in)); end if;
  end if;
  if new.linkedin_url is distinct from old.linkedin_url and coalesce(btrim(new.linkedin_url), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'linkedin_url', to_jsonb(new.linkedin_url), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'linkedin_url', to_jsonb(new.linkedin_url)); end if;
  end if;
  if new.background is distinct from old.background and coalesce(btrim(new.background), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'background', to_jsonb(new.background), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'background', to_jsonb(new.background)); end if;
  end if;
  if new.hook is distinct from old.hook and coalesce(btrim(new.hook), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'hook', to_jsonb(new.hook), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'hook', to_jsonb(new.hook)); end if;
  end if;
  if new.watch_outs is distinct from old.watch_outs and coalesce(btrim(new.watch_outs), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'watch_outs', to_jsonb(new.watch_outs), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'watch_outs', to_jsonb(new.watch_outs)); end if;
  end if;
  if new.intro_path is distinct from old.intro_path and coalesce(btrim(new.intro_path), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'intro_path', to_jsonb(new.intro_path), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'intro_path', to_jsonb(new.intro_path)); end if;
  end if;
  if new.email_guess is distinct from old.email_guess and coalesce(btrim(new.email_guess), '') <> '' then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'email_guess', to_jsonb(new.email_guess), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'email_guess', to_jsonb(new.email_guess)); end if;
  end if;
  if new.kill_words is distinct from old.kill_words and coalesce(array_length(new.kill_words, 1), 0) > 0 then
    if v_admin then perform public.catalog_person_admin_set_field(new.catalog_person_id, 'kill_words', to_jsonb(new.kill_words), new.org_id);
    else perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'kill_words', to_jsonb(new.kill_words)); end if;
  end if;

  return new;
end $function$;

-- ------------------------------------------ §3.3 creating a person
create or replace function public.contribute_catalog_person(p_org_id uuid, p_user_id uuid, p_catalog_entity_id uuid, p_full_name text, p_source_url text, p_title text default null::text, p_points integer default 0, p_validated_fields jsonb default '[]'::jsonb, p_detected_language text default null::text, p_original_title text default null::text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_person_id uuid;
  v_name text := btrim(p_full_name);
  v_batch text := 'founder_contribution:' || gen_random_uuid()::text;
  v_notes text;
  v_admin boolean := auth.uid() is not null and public.is_platform_admin();
  v_kind affiliation_kind;
  v_rank int;
  v_source_url text := nullif(btrim(p_source_url), '');
begin
  if v_name is null or v_name = '' then
    raise exception 'contribute_catalog_person: full_name is required';
  end if;
  -- Prompt 642 §3.3(b): the developer does not have to prove; a founder does.
  if v_source_url is null and not v_admin then
    raise exception 'contribute_catalog_person: source_url is required';
  end if;

  -- Prompt 642 §3.3(a): the admin may add people to any catalogue entity.
  if not v_admin and not exists (
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
    insert into public.catalog_people (full_name, entity_id, hook_status, enrichment_status, source_kind, source_url, source_confidence, source_recorded_at)
      values (v_name, p_catalog_entity_id, 'to_research', 'pending',
              case when v_admin then 'manual' else null end, v_source_url,
              case when v_admin then 'recorded' else null end, case when v_admin then now() end)
      returning id into v_person_id;
  elsif v_admin then
    update public.catalog_people set source_kind = 'manual', source_confidence = 'recorded', source_recorded_at = now(), source_url = coalesce(v_source_url, source_url), updated_at = now()
     where id = v_person_id;
  end if;

  -- Prompt 642 §3.3(e): the kind follows the title, not a fixed 'other'.
  v_kind := case
    when p_title ~* 'partner' then 'partner'
    when p_title ~* 'principal' then 'principal'
    when p_title ~* 'associate|analyst' then 'associate'
    when p_title ~* 'advisor' then 'advisor'
    when p_title ~* '\ychair|board' then 'board_member'
    else 'other' end;
  v_rank := public.catalog_seniority_rank_from_title(p_title);

  -- Prompt 643 §2(c): primary only when the person has none.
  insert into public.catalog_person_affiliations (person_id, entity_id, title, kind, current, is_primary, seniority_rank)
    values (v_person_id, p_catalog_entity_id, p_title, v_kind, true,
            not exists (select 1 from public.catalog_person_affiliations x where x.person_id = v_person_id and x.is_primary),
            v_rank)
  on conflict (person_id, entity_id, kind) do update
    set title = coalesce(excluded.title, public.catalog_person_affiliations.title),
        seniority_rank = coalesce(excluded.seniority_rank, public.catalog_person_affiliations.seniority_rank),
        current = true;

  if v_admin then
    -- Prompt 642 §3.3(d): the role is the developer's word.
    insert into public.catalog_people_research (person_id, verified_fields) values (v_person_id, jsonb_build_object('role', 'verified_by_admin'))
    on conflict (person_id) do update set verified_fields = public.catalog_people_research.verified_fields || jsonb_build_object('role', 'verified_by_admin'), updated_at = now();
    v_notes := 'Developer contribution (Prompt 642 §3.3)' || case when v_source_url is null then ' — sem fonte, por decisão do developer' else '' end;
    insert into public.catalog_entity_enrichment_sources (
      entity_id, person_id, source_url, source_type, verified_at, supports, quality, notes, batch_id, contributed_by_org_id, contributed_by_user_id
    ) values (
      p_catalog_entity_id, v_person_id, coalesce(v_source_url, 'admin:' || auth.uid()::text), 'admin_contribution', current_date,
      'person_affiliation', 'developer_recorded', v_notes, 'admin_contribution:' || gen_random_uuid()::text, p_org_id, auth.uid()
    );
    insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (auth.uid(), 'catalog_person_admin_created', 'catalog_person', v_person_id,
            jsonb_build_object('entity_id', p_catalog_entity_id, 'title', p_title, 'kind', v_kind, 'source_url', v_source_url));
    return jsonb_build_object('person_id', v_person_id, 'points_awarded', 0, 'balance', (select coalesce(sum(points), 0) from public.contribution_points where org_id = p_org_id));
  end if;

  v_notes := 'Founder contribution, AI-validated (Prompt 507). Validated fields: '
    || coalesce(p_validated_fields::text, '[]')
    || case when p_detected_language is not null then '. Source language: ' || p_detected_language else '' end
    || case when p_original_title is not null then '. Original title: ' || p_original_title else '' end;

  insert into public.catalog_entity_enrichment_sources (
    entity_id, person_id, source_url, source_type, verified_at, supports, quality, notes,
    batch_id, contributed_by_org_id, contributed_by_user_id
  ) values (
    p_catalog_entity_id, v_person_id, v_source_url, 'founder_contribution', current_date,
    'person_affiliation', 'ai_validated', v_notes,
    v_batch, p_org_id, p_user_id
  );

  if p_points > 0 then
    insert into public.contribution_points (
      org_id, awarded_to_user_id, points, reason, catalog_entity_id, catalog_person_id, source_url, detail
    ) values (
      p_org_id, p_user_id, p_points, 'catalog_person_contribution',
      p_catalog_entity_id, v_person_id, v_source_url,
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

-- --------------------------------------------- §2.2 the dossier feeds the ledger
create or replace function public.entities_dossier_contribute(p_entity uuid, p_org uuid, p_uid uuid, p_field text, p_new jsonb, p_old jsonb)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if p_new is null or jsonb_typeof(p_new) = 'null' then return; end if;
  if jsonb_typeof(p_new) = 'array' and jsonb_array_length(p_new) = 0 then return; end if;
  if jsonb_typeof(p_new) = 'string' and btrim(p_new #>> '{}') = '' then return; end if;
  if p_new is not distinct from p_old then return; end if;
  insert into contributions (subject_type, subject_id, org_id, author_user_id, field, value, status, source, kind, created_at)
  values ('entity', p_entity, p_org, p_uid, p_field, p_new, 'submitted', 'user', 'fill', now());
end $fn$;
revoke all on function public.entities_dossier_contribute(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.entities_dossier_to_contributions()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_catalog uuid;
  v_admin boolean;
begin
  if v_uid is null then return new; end if;
  v_catalog := coalesce(new.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = new.id limit 1));
  if v_catalog is null then return new; end if;
  v_admin := public.is_platform_admin();

  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'website', to_jsonb(new.website), to_jsonb(old.website));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'email', to_jsonb(new.email), to_jsonb(old.email));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'phone', to_jsonb(new.phone), to_jsonb(old.phone));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'address', to_jsonb(new.address), to_jsonb(old.address));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'postal_code', to_jsonb(new.postal_code), to_jsonb(old.postal_code));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'hq_city', to_jsonb(new.hq_city), to_jsonb(old.hq_city));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'hq_country', to_jsonb(new.hq_country), to_jsonb(old.hq_country));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'sectors', to_jsonb(new.sectors), to_jsonb(old.sectors));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'geographies', to_jsonb(new.invests_in_geographies), to_jsonb(old.invests_in_geographies));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'stage_min', to_jsonb(new.stage_min::text), to_jsonb(old.stage_min::text));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'stage_max', to_jsonb(new.stage_max::text), to_jsonb(old.stage_max::text));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'check_min_eur', to_jsonb(new.check_min_eur), to_jsonb(old.check_min_eur));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'check_max_eur', to_jsonb(new.check_max_eur), to_jsonb(old.check_max_eur));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'thesis', to_jsonb(new.thesis), to_jsonb(old.thesis));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'submission_channel', to_jsonb(new.submission_channel), to_jsonb(old.submission_channel));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'submission_channel_type', to_jsonb(new.submission_channel_type), to_jsonb(old.submission_channel_type));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'key_people', to_jsonb(new.key_people), to_jsonb(old.key_people));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'aum', to_jsonb(new.aum), to_jsonb(old.aum));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'current_funds', to_jsonb(new.current_funds), to_jsonb(old.current_funds));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'latest_fund', to_jsonb(new.latest_fund), to_jsonb(old.latest_fund));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'last_investment_found', to_jsonb(new.last_investment_found), to_jsonb(old.last_investment_found));
  perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'linkedin_url', to_jsonb(new.linkedin_url), to_jsonb(old.linkedin_url));
  -- A person's e-mail is admin-only (635 §1.1): a founder's edit of it never leaves the org.
  if v_admin then
    perform public.entities_dossier_contribute(new.id, new.org_id, v_uid, 'general_partner_emails', to_jsonb(new.general_partner_emails), to_jsonb(old.general_partner_emails));
  end if;
  return new;
exception when others then
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (v_uid, 'entities_dossier_contribution_error', 'entity', new.id, jsonb_build_object('error', sqlerrm));
  return new;
end $fn$;

drop trigger if exists trg_entities_dossier_to_contributions on public.entities;
create trigger trg_entities_dossier_to_contributions
  after update on public.entities
  for each row execute function public.entities_dossier_to_contributions();
