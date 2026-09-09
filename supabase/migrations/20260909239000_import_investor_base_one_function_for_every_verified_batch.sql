-- Prompt 639 §3 + Prompt 640 — import_investor_base(): one function, not a
-- data migration. The Base_Investidores_EU_UK file is v2 today and will be
-- v3, and there will be bases for other geographies; the function accepts
-- the six sheets as JSON, applies every rule of 639 §2 (with 640's delta),
-- and is idempotent on natural keys — entity by reconciled id, then domain,
-- then name; person by normalize_person_name() inside the firm; source by
-- (entity, person, url); notes appended only when the text is not already
-- there. Running v1 then the delta, or v2 in one go, or v2 twice, lands the
-- same catalogue.
--
-- DRY RUN IS THE SAME CODE PATH. p_dry_run = true performs every write and
-- then raises with the report as the message, so the transaction rolls back
-- and nothing persists. What the report says a dry run would do is exactly
-- what the apply does, because it is the apply.
--
-- What this file also carries, because the import needs it and the next
-- file will too:
--   · fx_rates_to_eur — ONE table for USD/GBP→EUR (640 §2.1: "numa
--     constante partilhada, não uma cópia em cada sítio"). The worker's
--     USD_TO_EUR (API cost) stays where it is; this table is the catalogue's
--     ticket-size rate, and the two are kept in step by hand at 0.865.
--   · matchdeal_text_to_stage — the old body only cast an enum label; it
--     now understands the words a human writes (Pre-seed, Inception, Day 1,
--     Growth, IPO, Buyout, Late Seed, Series C…) and returns null for
--     follow-on policy, which is not an entry stage (640 §2.2).
--   · normalize_country_code — the file is in Portuguese. The alias map is
--     THE one place (627 §2.1), so the Portuguese names go there.
--   · catalog_people_research.hook_source may now be 'manual_research'.
--
-- What deliberately does NOT happen here: no new columns for things the
-- schema lacks (is_generalist is 627 block 4's, not this file's — the term
-- stays in sectors and is reported); no invented Smedvig holding (640 §3.2);
-- no LinkedIn URL in website or team_page_url, ever (640 §3.1); the 141
-- `Base` profiles get everything except a hook (639 §2.3).

-- ---------------------------------------------------------------- fx rates
create table if not exists public.fx_rates_to_eur (
  code   text primary key check (code ~ '^[A-Z]{3}$'),
  rate   numeric not null check (rate > 0),
  as_of  date not null,
  source text not null
);
alter table public.fx_rates_to_eur enable row level security;
revoke all on public.fx_rates_to_eur from public, anon, authenticated;
comment on table public.fx_rates_to_eur is
  'Prompt 640 §2.1 — the one place a non-EUR ticket size is converted from. Edit the row, not the code.';

insert into public.fx_rates_to_eur (code, rate, as_of, source) values
  ('EUR', 1,     '2026-09-09', 'identity'),
  ('USD', 0.865, '2026-09-09', 'Prompt 137 §5 — same figure as the worker''s USD_TO_EUR; keep the two in step by hand'),
  ('GBP', 1.16,  '2026-09-04', 'xe.com mid-market 1.1633 on 2026-09-04 (early September range 1.163–1.166), found by web search on 2026-09-09; 640 §2.1 had proposed 1.17')
on conflict (code) do update set rate = excluded.rate, as_of = excluded.as_of, source = excluded.source;

create or replace function public.fx_to_eur(p_code text)
returns numeric language sql stable set search_path = public as $$
  select rate from public.fx_rates_to_eur where code = upper(btrim(coalesce(p_code, 'EUR')));
$$;
revoke all on function public.fx_to_eur(text) from public, anon;

-- ------------------------------------------------------------- stage words
-- Superset of the old behaviour: an enum label still casts; everything else
-- is what a human writes in a spreadsheet. Follow-on wording returns null on
-- purpose — it is a policy about later rounds, not a stage a founder enters.
create or replace function public.matchdeal_text_to_stage(p text)
returns stage
language plpgsql immutable set search_path to 'public' as $fn$
declare
  v text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  v := regexp_replace(lower(btrim(p)), '\s+', ' ', 'g');
  begin
    return v::stage;
  exception when others then
    null;
  end;
  if v ~ 'follow.?on|subsequente|subsequent' then return null; end if;
  if v ~ '^(pre.?seed|inception|day ?(1|one)|pre.?idea|idea(tion)?|angel)' then return 'pre_seed'; end if;
  if v ~ '^(late )?seed' then return 'seed'; end if;
  if v ~ '^series ?a' then return 'series_a'; end if;
  if v ~ '^series ?b' then return 'series_b'; end if;
  if v ~ '^series ?[c-z]' then return 'series_c_plus'; end if;
  if v ~ '^(growth|late.?stage|later|ipo|pre.?ipo|buyout|expansion|scale.?up)' then return 'later'; end if;
  return null;
end $fn$;

-- -------------------------------------------------------- country aliases
create or replace function public.normalize_country_code(p text)
returns text language sql immutable as $function$
  select case when p is null or btrim(p) = '' then null else
    coalesce(
      case lower(btrim(p))
        when 'portugal' then 'PT'  when 'spain' then 'ES'   when 'españa' then 'ES'   when 'espanha' then 'ES'
        when 'united kingdom' then 'GB' when 'uk' then 'GB' when 'great britain' then 'GB' when 'reino unido' then 'GB'
        when 'england' then 'GB'   when 'scotland' then 'GB' when 'wales' then 'GB'
        when 'germany' then 'DE'   when 'deutschland' then 'DE' when 'alemanha' then 'DE'
        when 'france' then 'FR'    when 'frança' then 'FR'  when 'franca' then 'FR'
        when 'netherlands' then 'NL' when 'the netherlands' then 'NL' when 'holland' then 'NL'
        when 'países baixos' then 'NL' when 'paises baixos' then 'NL' when 'holanda' then 'NL'
        when 'switzerland' then 'CH' when 'suíça' then 'CH'  when 'suica' then 'CH'
        when 'sweden' then 'SE'    when 'suécia' then 'SE'  when 'suecia' then 'SE'
        when 'denmark' then 'DK'   when 'dinamarca' then 'DK'
        when 'finland' then 'FI'   when 'finlândia' then 'FI' when 'finlandia' then 'FI'
        when 'norway' then 'NO'    when 'noruega' then 'NO'
        when 'ireland' then 'IE'   when 'irlanda' then 'IE'
        when 'belgium' then 'BE'   when 'bélgica' then 'BE' when 'belgica' then 'BE'
        when 'italy' then 'IT'     when 'itália' then 'IT'  when 'italia' then 'IT'
        when 'austria' then 'AT'   when 'áustria' then 'AT'
        when 'luxembourg' then 'LU' when 'luxemburgo' then 'LU'
        when 'poland' then 'PL'    when 'polónia' then 'PL' when 'polonia' then 'PL'
        when 'greece' then 'GR'    when 'grécia' then 'GR'  when 'grecia' then 'GR'
        when 'czech republic' then 'CZ' when 'czechia' then 'CZ' when 'chéquia' then 'CZ'
        when 'hungary' then 'HU'   when 'hungria' then 'HU'
        when 'romania' then 'RO'   when 'roménia' then 'RO' when 'romenia' then 'RO'
        when 'bulgaria' then 'BG'  when 'bulgária' then 'BG'
        when 'croatia' then 'HR'   when 'croácia' then 'HR' when 'croacia' then 'HR'
        when 'slovenia' then 'SI'  when 'eslovénia' then 'SI' when 'eslovenia' then 'SI'
        when 'slovakia' then 'SK'  when 'eslováquia' then 'SK' when 'eslovaquia' then 'SK'
        when 'estonia' then 'EE'   when 'estónia' then 'EE'
        when 'latvia' then 'LV'    when 'letónia' then 'LV'  when 'letonia' then 'LV'
        when 'lithuania' then 'LT' when 'lituânia' then 'LT' when 'lituania' then 'LT'
        when 'iceland' then 'IS'   when 'islândia' then 'IS' when 'islandia' then 'IS'
        when 'malta' then 'MT'     when 'cyprus' then 'CY'  when 'chipre' then 'CY'
        when 'united states' then 'US' when 'usa' then 'US' when 'u.s.' then 'US'
        when 'united states of america' then 'US' when 'estados unidos' then 'US' when 'eua' then 'US'
        when 'brazil' then 'BR' when 'brasil' then 'BR'
        else null end,
      case when length(btrim(p)) = 2 then upper(btrim(p)) else null end
    )
  end;
$function$;

-- ------------------------------------------------ human-verified hook source
alter table public.catalog_people_research drop constraint if exists catalog_people_research_hook_source_check;
alter table public.catalog_people_research
  add constraint catalog_people_research_hook_source_check
  check (hook_source is null or hook_source in ('bio', 'web', 'manual_research'));

-- --------------------------------------------------------------- importer
create or replace function public.import_investor_base(p_batch_id text, p_payload jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  -- nunomarujo@ablute.pt — the platform_admins account the file's
  -- "verified by" means. 639 §4: nothing here passes through consensus.
  v_admin        constant uuid := 'c934d05b-1838-46fc-8c75-d2a454f3aa38';
  v_verified_on  constant date := '2026-09-09';
  v_batch        text := coalesce(nullif(btrim(p_batch_id), ''), 'base_investidores_' || to_char(now(), 'YYYYMMDD'));

  r              jsonb;
  ent_map        jsonb := '{}'::jsonb;   -- file investor id  -> entity uuid
  per_map        jsonb := '{}'::jsonb;   -- file person id    -> person uuid
  hook_map       jsonb := '{}'::jsonb;   -- file hook id      -> {entity, person}
  sig_map        jsonb := '{}'::jsonb;   -- file signal id    -> {entity, person}
  deferred_team  jsonb := '[]'::jsonb;   -- LinkedIn person profiles given as Fonte_Equipa

  v_file_id text; v_entity uuid; v_person uuid; v_level text; v_conf text;
  v_website text; v_existing_website text; v_url text; v_txt text; v_part text; v_parts text[];
  v_country text; v_codes text[]; v_first_city text; v_other_cities text;
  v_stage stage; v_stage_ranks int[]; v_rank int; v_min int; v_max int;
  v_min_m numeric; v_max_m numeric; v_cur text; v_fx numeric;
  v_sectors text[]; v_thesis_existing text; v_email text; v_pitch text;
  v_notes text; v_row record; v_kind affiliation_kind; v_title text; v_seniority int;
  v_hook text; v_state text; v_bg text; v_existing_bg text; v_action text; v_aff uuid; v_aff_kind affiliation_kind;
  v_linkedin text; v_supports text; v_prova text; v_reg text; v_person_entity uuid; v_pub text;
  v_name text; v_written boolean; v_n int; v_created boolean;
  v_is_new boolean;

  -- report
  c_ent_updated int := 0; c_ent_created int := 0; c_ent_fields int := 0; c_conflicts int := 0;
  c_ppl_created int := 0; c_ppl_updated int := 0; c_ppl_affiliated int := 0;
  c_hooks_written int := 0; c_hooks_base int := 0; c_hooks_empty int := 0;
  c_contents int := 0; c_signals int := 0; c_signals_rejected int := 0;
  c_src_inserted int := 0; c_src_existing int := 0; c_src_unresolved int := 0;
  c_fx int := 0; c_team_page int := 0; c_linkedin_kept_out int := 0; c_renamed int := 0; c_demo_promoted int := 0;
  c_linkedin_person int := 0; c_linkedin_person_skipped int := 0;
  unknown_stages text[] := '{}'; unknown_countries text[] := '{}'; sector_raw text[] := '{}'; sector_norm text[] := '{}';
  conflicts jsonb := '[]'::jsonb; report jsonb;

  -- helpers as inline expressions
  function_name text := 'import_investor_base';
begin
  if current_user not in ('postgres', 'service_role') and not public.is_platform_admin() then
    raise exception '%: not authorized', function_name;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '%: payload must be an object with investors/people/hooks/signals/sources', function_name;
  end if;

  -- 633's lesson: a verified insert fires catalog_entities_verified_event and
  -- writes an investor_registered analytics row. Four fund entities Nuno
  -- researched are not four registrations. DDL is transactional, so a dry run
  -- rolls this back too.
  alter table public.catalog_entities disable trigger catalog_entities_verified_event;

  -- ============================================================ entities
  for r in select * from jsonb_array_elements(coalesce(p_payload->'investors', '[]'::jsonb)) loop
    v_file_id := r->>'ID_Investidor';
    v_name := btrim(r->>'Nome');
    v_conf := r->>'Confiança';
    v_level := case when v_conf = 'Alta' then 'verified_by_admin' else 'plausible_by_startups' end;
    v_website := nullif(btrim(r->>'Website'), '');
    v_is_new := false;

    -- resolve: reconciled id, else domain, else exact name
    v_entity := null;
    begin
      v_entity := nullif(btrim(r->>'catalog_entity_id'), '')::uuid;
    exception when others then
      v_entity := null;
    end;
    if v_entity is not null and not exists (select 1 from catalog_entities where id = v_entity) then v_entity := null; end if;
    if v_entity is null and v_website is not null and v_website !~* 'linkedin\.com' then
      select id into v_entity from catalog_entities
       where coalesce(moderation_status, 'active') <> 'deleted'
         and lower(regexp_replace(website, '^https?://(www\.)?([^/]+).*$', '\2')) = lower(regexp_replace(v_website, '^https?://(www\.)?([^/]+).*$', '\2'))
       order by (verification_status = 'verified') desc, created_at limit 1;
    end if;
    if v_entity is null then
      select id into v_entity from catalog_entities where lower(name) = lower(v_name) and coalesce(moderation_status, 'active') <> 'deleted' order by created_at limit 1;
    end if;

    if v_entity is null then
      insert into catalog_entities (name, type, website, verification_status, catalog_status, source, verified_by, verified_at, is_test, enrichment_status, verified_fields)
      values (v_name,
              (case lower(r->>'Tipo') when 'family office' then 'family_office' when 'vc público' then 'public_body' when 'corporate vc' then 'corporate_vc' else 'vc' end)::entity_type,
              case when v_website ~* 'linkedin\.com' then null else v_website end,
              'verified', 'verified', 'verified_import', v_admin, v_verified_on, false, 'pending', '{}'::jsonb)
      returning id into v_entity;
      c_ent_created := c_ent_created + 1; v_is_new := true;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (v_admin, 'import_entity_created', 'catalog_entity', v_entity, jsonb_build_object('batch', v_batch, 'file_id', v_file_id, 'name', v_name));
    else
      c_ent_updated := c_ent_updated + 1;
      -- 639 §5.1 (decided in 640): the file has the parent fund, the catalogue had the sub-fund.
      if v_file_id = 'INV005' and (select name from catalog_entities where id = v_entity) = 'Speedinvest Health' then
        update catalog_entities set name = 'Speedinvest' where id = v_entity;
        c_renamed := c_renamed + 1;
        insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
        values (v_admin, 'import_entity_renamed', 'catalog_entity', v_entity, jsonb_build_object('batch', v_batch, 'from', 'Speedinvest Health', 'to', 'Speedinvest'));
      end if;
      -- 639 §1.1: human-verified data is not demo.
      if (select catalog_status from catalog_entities where id = v_entity) = 'demo' then
        update catalog_entities set catalog_status = 'verified', verified_by = coalesce(verified_by, v_admin), verified_at = coalesce(verified_at, v_verified_on) where id = v_entity;
        c_demo_promoted := c_demo_promoted + 1;
        insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
        values (v_admin, 'import_entity_demo_promoted', 'catalog_entity', v_entity, jsonb_build_object('batch', v_batch, 'file_id', v_file_id));
      end if;
    end if;
    ent_map := ent_map || jsonb_build_object(v_file_id, v_entity);

    -- website: only fills a blank; a different value is a conflict, audited, and the file's wins (639 §2.1)
    if v_website is not null then
      if v_website ~* 'linkedin\.com' then
        c_linkedin_kept_out := c_linkedin_kept_out + 1;
        v_txt := 'linkedin_company_url: ' || v_website;
        update catalog_entities set notes = case when notes is null or notes = '' then v_txt when position(v_txt in notes) = 0 then notes || E'\n' || v_txt else notes end where id = v_entity;
      else
        select website into v_existing_website from catalog_entities where id = v_entity;
        if v_existing_website is not null and public.normalize_url(v_existing_website) is distinct from public.normalize_url(v_website) then
          c_conflicts := c_conflicts + 1;
          conflicts := conflicts || jsonb_build_object('file_id', v_file_id, 'field', 'website', 'existing', v_existing_website, 'incoming', v_website);
          insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
          values (v_admin, 'import_conflict', 'catalog_entity', v_entity, jsonb_build_object('batch', v_batch, 'field', 'website', 'existing', v_existing_website, 'incoming', v_website));
        end if;
        if v_is_new or v_existing_website is null or public.normalize_url(v_existing_website) is distinct from public.normalize_url(v_website) then
          if public.catalog_entity_apply_field(v_entity, 'website', to_jsonb(v_website), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        end if;
      end if;
    end if;

    -- country: first of "A / B" is the seat, both are geographies (639 §2.1)
    v_txt := nullif(btrim(r->>'País_Sede'), '');
    if v_txt is not null then
      v_parts := regexp_split_to_array(v_txt, '\s*/\s*');
      v_codes := '{}';
      foreach v_part in array v_parts loop
        v_country := public.normalize_country_code(v_part);
        if v_country is null then unknown_countries := array_append(unknown_countries, v_part);
        else v_codes := array_append(v_codes, v_country); end if;
      end loop;
      if cardinality(v_codes) > 0 then
        if public.catalog_entity_apply_field(v_entity, 'hq_country', to_jsonb(v_codes[1]), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        if cardinality(v_codes) > 1 then
          if public.catalog_entity_apply_field(v_entity, 'geographies', to_jsonb(v_codes), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        end if;
      end if;
    end if;

    -- city: the first; the others to notes
    v_txt := nullif(btrim(r->>'Cidades'), '');
    if v_txt is not null then
      v_parts := regexp_split_to_array(v_txt, '\s*;\s*');
      v_first_city := v_parts[1];
      if public.catalog_entity_apply_field(v_entity, 'hq_city', to_jsonb(v_first_city), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
      if cardinality(v_parts) > 1 then
        v_other_cities := 'other offices: ' || array_to_string(v_parts[2:], '; ');
        update catalog_entities set notes = case when notes is null or notes = '' then v_other_cities when position(v_other_cities in notes) = 0 then notes || E'\n' || v_other_cities else notes end where id = v_entity;
      end if;
    end if;

    -- stages: min/max over the recognised terms; the unrecognised are reported, never nulled silently
    v_txt := nullif(btrim(r->>'Estágios'), '');
    if v_txt is not null then
      v_min := null; v_max := null;
      foreach v_part in array regexp_split_to_array(v_txt, '\s*;\s*') loop
        v_stage := public.matchdeal_text_to_stage(v_part);
        if v_stage is null then
          if lower(v_part) !~ 'follow.?on|subsequente' then unknown_stages := array_append(unknown_stages, v_part); end if;
        else
          v_rank := case v_stage when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3 when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
          if v_rank is not null then
            v_min := least(coalesce(v_min, v_rank), v_rank); v_max := greatest(coalesce(v_max, v_rank), v_rank);
          end if;
        end if;
      end loop;
      if v_min is not null then
        if public.catalog_entity_apply_field(v_entity, 'stage_min', to_jsonb((array['pre_seed','seed','series_a','series_b','series_c_plus','later'])[v_min]), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        if public.catalog_entity_apply_field(v_entity, 'stage_max', to_jsonb((array['pre_seed','seed','series_a','series_b','series_c_plus','later'])[v_max]), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
      end if;
    end if;

    -- ticket: ×1 000 000, converted from the one rate table; the original kept in notes
    v_min_m := nullif(replace(btrim(coalesce(r->>'Ticket_Min_M', '')), ',', '.'), '')::numeric;
    v_max_m := nullif(replace(btrim(coalesce(r->>'Ticket_Max_M', '')), ',', '.'), '')::numeric;
    v_cur := upper(nullif(btrim(r->>'Moeda'), ''));
    if v_min_m is not null or v_max_m is not null then
      v_cur := coalesce(v_cur, 'EUR');
      v_fx := public.fx_to_eur(v_cur);
      if v_fx is null then
        unknown_countries := array_append(unknown_countries, 'currency:' || v_cur);
      else
        if v_min_m is not null and public.catalog_entity_apply_field(v_entity, 'check_min_eur', to_jsonb(round(v_min_m * 1000000 * v_fx)::bigint), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        if v_max_m is not null and public.catalog_entity_apply_field(v_entity, 'check_max_eur', to_jsonb(round(v_max_m * 1000000 * v_fx)::bigint), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
        if v_cur <> 'EUR' then
          c_fx := c_fx + 1;
          v_txt := 'ticket original: ' || coalesce(v_min_m::text, '?') || '–' || coalesce(v_max_m::text, '?') || ' M ' || v_cur || ' @' || v_fx::text;
          update catalog_entities set notes = case when notes is null or notes = '' then v_txt when position(v_txt in notes) = 0 then notes || E'\n' || v_txt else notes end where id = v_entity;
        end if;
      end if;
    end if;

    -- sectors: raw list into sectors, the shared normaliser into sectors_normalized
    v_txt := nullif(btrim(r->>'Setores'), '');
    if v_txt is not null then
      select array_agg(btrim(x)) into v_sectors from unnest(regexp_split_to_array(v_txt, '\s*;\s*')) x where btrim(x) <> '';
      if public.catalog_entity_apply_field(v_entity, 'sectors', to_jsonb(v_sectors), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
      update catalog_entities set sectors_normalized = public.sector_terms(v_sectors) where id = v_entity;
      sector_raw := sector_raw || v_sectors;
      sector_norm := sector_norm || public.sector_terms(v_sectors);
    end if;

    -- thesis: replaces a blank or a stub (< 80 chars); otherwise goes to notes
    v_txt := nullif(btrim(r->>'Tese'), '');
    if v_txt is not null then
      select thesis into v_thesis_existing from catalog_entities where id = v_entity;
      if v_thesis_existing is null or length(btrim(v_thesis_existing)) < 80 then
        if public.catalog_entity_apply_field(v_entity, 'thesis', to_jsonb(v_txt), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
      else
        v_txt := 'thesis (file ' || v_verified_on::text || '): ' || v_txt;
        update catalog_entities set notes = case when notes is null or notes = '' then v_txt when position(v_txt in notes) = 0 then notes || E'\n' || v_txt else notes end where id = v_entity;
      end if;
    end if;

    -- contact: an e-mail is an e-mail; anything else describes the channel
    v_txt := nullif(btrim(r->>'Contacto_Geral'), '');
    v_email := substring(coalesce(v_txt, '') from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
    if v_email is not null then
      if public.catalog_entity_apply_field(v_entity, 'email', to_jsonb(lower(v_email)), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
    end if;
    v_pitch := nullif(btrim(r->>'Envio_Pitch'), '');
    if v_pitch ~* '^https?://' then
      if public.catalog_entity_apply_field(v_entity, 'submission_channel', to_jsonb(v_pitch), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
      v_pitch := 'website';
    end if;
    v_pitch := coalesce(v_pitch, case when v_email is null then v_txt end);
    if v_pitch is not null then
      if public.catalog_entity_apply_field(v_entity, 'submission_channel_type', to_jsonb(v_pitch), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; end if;
    end if;

    -- team page: the column that was 0 of 762 since always. Never a LinkedIn URL (640 §3.1).
    v_url := nullif(btrim(r->>'Fonte_Equipa'), '');
    if v_url is not null then
      if v_url ~* 'linkedin\.com/in/' then
        deferred_team := deferred_team || jsonb_build_object('file_id', v_file_id, 'entity', v_entity, 'url', v_url);
        c_linkedin_kept_out := c_linkedin_kept_out + 1;
      elsif v_url ~* 'linkedin\.com' then
        c_linkedin_kept_out := c_linkedin_kept_out + 1;
        v_txt := 'linkedin_company_url: ' || v_url;
        update catalog_entities set notes = case when notes is null or notes = '' then v_txt when position(v_txt in notes) = 0 then notes || E'\n' || v_txt else notes end where id = v_entity;
        if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is null and source_url = v_url) then
          insert into catalog_entity_enrichment_sources (entity_id, source_url, source_type, quality, supports, verified_at, batch_id, notes)
          values (v_entity, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'team', v_verified_on, v_batch, 'LinkedIn company page used as the team source; not a website');
          c_src_inserted := c_src_inserted + 1;
        else c_src_existing := c_src_existing + 1; end if;
      else
        if public.catalog_entity_apply_field(v_entity, 'team_page_url', to_jsonb(v_url), v_level, v_verified_on::timestamptz) then c_ent_fields := c_ent_fields + 1; c_team_page := c_team_page + 1; end if;
        update catalog_entities set team_page_checked_at = v_verified_on where id = v_entity;
        if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is null and source_url = v_url) then
          insert into catalog_entity_enrichment_sources (entity_id, source_url, source_type, quality, supports, verified_at, batch_id)
          values (v_entity, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'team', v_verified_on, v_batch);
          c_src_inserted := c_src_inserted + 1;
        else c_src_existing := c_src_existing + 1; end if;
      end if;
    end if;
    v_url := nullif(btrim(r->>'Fonte_Tese'), '');
    if v_url is not null and v_url !~* 'linkedin\.com' then
      if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is null and source_url = v_url) then
        insert into catalog_entity_enrichment_sources (entity_id, source_url, source_type, quality, supports, verified_at, batch_id)
        values (v_entity, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'thesis', v_verified_on, v_batch);
        c_src_inserted := c_src_inserted + 1;
      else c_src_existing := c_src_existing + 1; end if;
    end if;

    -- notes from the file
    v_txt := nullif(btrim(r->>'Notas'), '');
    if v_txt is not null then
      update catalog_entities set notes = case when notes is null or notes = '' then v_txt when position(v_txt in notes) = 0 then notes || E'\n' || v_txt else notes end where id = v_entity;
    end if;
  end loop;

  -- ============================================================== people
  for r in select * from jsonb_array_elements(coalesce(p_payload->'people', '[]'::jsonb)) loop
    v_file_id := r->>'ID_Pessoa';
    v_entity := (ent_map->>(r->>'ID_Investidor'))::uuid;
    if v_entity is null then c_src_unresolved := c_src_unresolved + 1; continue; end if;
    v_name := btrim(r->>'Nome');
    v_action := coalesce(r->>'accao', 'CRIAR');
    v_conf := r->>'Confiança';
    v_level := case when v_conf = 'Alta' then 'verified_by_admin' else 'plausible_by_startups' end;
    v_linkedin := nullif(btrim(r->>'LinkedIn'), '');
    v_title := nullif(btrim(r->>'Cargo_Atual'), '');

    v_person := null;
    begin
      v_person := nullif(btrim(r->>'catalog_person_id'), '')::uuid;
    exception when others then
      v_person := null;
    end;
    if v_person is not null and not exists (select 1 from catalog_people where id = v_person) then v_person := null; end if;
    if v_person is null then
      select p.id into v_person from catalog_people p
        join catalog_person_affiliations a on a.person_id = p.id and a.entity_id = v_entity
       where public.normalize_person_name(p.full_name) = public.normalize_person_name(v_name)
       order by p.created_at limit 1;
    end if;
    if v_person is null then
      select p.id into v_person from catalog_people p
       where p.entity_id = v_entity and public.normalize_person_name(p.full_name) = public.normalize_person_name(v_name)
       order by p.created_at limit 1;
    end if;

    -- a LinkedIn URL that already belongs to somebody else is not written twice
    if v_linkedin is not null and exists (
      select 1 from catalog_people p where p.linkedin_url_normalized is not null
         and p.linkedin_url_normalized = lower(regexp_replace(regexp_replace(v_linkedin, '\?.*$', ''), '/+$', ''))
         and (v_person is null or p.id <> v_person)) then
      c_linkedin_person_skipped := c_linkedin_person_skipped + 1;
      v_linkedin := null;
    end if;

    v_created := false;
    if v_person is null then
      begin
        insert into catalog_people (full_name, entity_id, linkedin_url, linkedin_verified, hook_status, based_in, source_kind, source_url, source_confidence, source_recorded_at, enrichment_status)
        values (v_name, v_entity, v_linkedin, v_linkedin is not null, 'to_research', nullif(btrim(r->>'Localização'), ''), 'manual', nullif(btrim(r->>'Perfil_Oficial'), ''), 'recorded', v_verified_on, 'pending')
        returning id into v_person;
      exception when unique_violation then
        insert into catalog_people (full_name, entity_id, hook_status, based_in, source_kind, source_url, source_confidence, source_recorded_at, enrichment_status)
        values (v_name, v_entity, 'to_research', nullif(btrim(r->>'Localização'), ''), 'manual', nullif(btrim(r->>'Perfil_Oficial'), ''), 'recorded', v_verified_on, 'pending')
        returning id into v_person;
        v_linkedin := null; c_linkedin_person_skipped := c_linkedin_person_skipped + 1;
      end;
      v_created := true; c_ppl_created := c_ppl_created + 1;
      if v_linkedin is not null then c_linkedin_person := c_linkedin_person + 1; end if;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (v_admin, 'import_person_created', 'catalog_person', v_person, jsonb_build_object('batch', v_batch, 'file_id', v_file_id, 'entity_id', v_entity));
    else
      update catalog_people
         set based_in = coalesce(nullif(btrim(r->>'Localização'), ''), based_in),
             source_url = coalesce(nullif(btrim(r->>'Perfil_Oficial'), ''), source_url),
             source_kind = 'manual', source_confidence = 'recorded', source_recorded_at = v_verified_on,
             linkedin_url = coalesce(linkedin_url, v_linkedin),
             linkedin_verified = linkedin_verified or (linkedin_url is null and v_linkedin is not null),
             updated_at = now()
       where id = v_person;
      if v_linkedin is not null then c_linkedin_person := c_linkedin_person + 1; end if;
      if v_action = 'AFILIAR_EXISTENTE' then c_ppl_affiliated := c_ppl_affiliated + 1; else c_ppl_updated := c_ppl_updated + 1; end if;
    end if;
    per_map := per_map || jsonb_build_object(v_file_id, v_person);

    -- affiliation: title of 2026-09-09 wins; rank from the v4 classifier, 2 when the file says Decisor and the classifier says nothing
    v_kind := case
      when v_title ~* 'partner' then 'partner'
      when v_title ~* 'principal' then 'principal'
      when v_title ~* 'associate|analyst' then 'associate'
      when v_title ~* 'advisor' then 'advisor'
      when v_title ~* '\ychair|board' then 'board_member'
      else 'other' end;
    v_seniority := public.catalog_seniority_rank_from_title(v_title);
    if v_seniority is null and r->>'Decisor' = 'Sim' then v_seniority := 2; end if;
    v_notes := nullif(btrim(r->>'Notas'), '');
    select id, kind into v_aff, v_aff_kind from catalog_person_affiliations where person_id = v_person and entity_id = v_entity order by is_primary desc, created_at limit 1;
    if v_aff is not null then
      update catalog_person_affiliations
         set title = coalesce(v_title, title),
             kind = case when v_aff_kind = v_kind then kind
                         when exists (select 1 from catalog_person_affiliations x where x.person_id = v_person and x.entity_id = v_entity and x.kind = v_kind and x.id <> v_aff) then kind
                         else v_kind end,
             seniority_rank = coalesce(v_seniority, seniority_rank),
             current = true,
             notes = case when v_notes is null then notes when notes is null or notes = '' then v_notes when position(v_notes in notes) = 0 then notes || E'\n' || v_notes else notes end
       where id = v_aff;
    else
      insert into catalog_person_affiliations (person_id, entity_id, title, kind, is_primary, current, seniority_rank, notes)
      values (v_person, v_entity, v_title, v_kind,
              v_action <> 'AFILIAR_EXISTENTE' or not exists (select 1 from catalog_person_affiliations x where x.person_id = v_person and x.is_primary),
              true, v_seniority, v_notes);
    end if;

    -- research: background only fills a blank; the hook only for Enriquecido/Parcial (639 §2.3)
    v_state := r->>'Estado_Perfil';
    v_hook := nullif(btrim(r->>'Hook_Principal'), '');
    v_bg := concat_ws(' · ',
              case when nullif(btrim(r->>'Foco_Setorial'), '') is not null then 'Focus: ' || btrim(r->>'Foco_Setorial') end,
              case when nullif(btrim(r->>'Foco_Fase'), '') is not null then 'Stage: ' || btrim(r->>'Foco_Fase') end,
              case when nullif(btrim(r->>'Experiência_Anterior'), '') is not null then 'Previously: ' || btrim(r->>'Experiência_Anterior') end,
              case when nullif(btrim(r->>'Empresas_Portfólio'), '') is not null then 'Portfolio: ' || btrim(r->>'Empresas_Portfólio') end);
    v_bg := nullif(v_bg, '');
    insert into catalog_people_research (person_id, verified_fields) values (v_person, '{}'::jsonb) on conflict (person_id) do nothing;
    select background into v_existing_bg from catalog_people_research where person_id = v_person;
    if v_bg is not null and v_existing_bg is null then
      update catalog_people_research set background = v_bg, verified_fields = verified_fields || jsonb_build_object('background', v_level), updated_at = now() where person_id = v_person;
    end if;
    if v_state in ('Enriquecido', 'Parcial') then
      if v_hook is not null then
        update catalog_people_research
           set hook = v_hook, hook_source = 'manual_research',
               verified_fields = verified_fields || jsonb_build_object('hook', v_level, 'hook_evidence', nullif(btrim(r->>'Fundamento_do_Hook'), ''), 'hook_verified_at', v_verified_on::text, 'hook_profile_state', v_state),
               updated_at = now()
         where person_id = v_person;
        update catalog_people set hook_status = 'researched', updated_at = now() where id = v_person;
        c_hooks_written := c_hooks_written + 1;
      else
        c_hooks_empty := c_hooks_empty + 1;
      end if;
    else
      c_hooks_base := c_hooks_base + 1;
    end if;

    -- provenance for every person: the official profile
    v_url := nullif(btrim(r->>'Perfil_Oficial'), '');
    if v_url is not null then
      if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id = v_person and source_url = v_url) then
        insert into catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, quality, supports, verified_at, batch_id)
        values (v_entity, v_person, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'person_affiliation', v_verified_on, v_batch);
        c_src_inserted := c_src_inserted + 1;
      else c_src_existing := c_src_existing + 1; end if;
    end if;
  end loop;

  -- a Fonte_Equipa that was a person's LinkedIn profile (H14) is that person's source, not the entity's team page
  for r in select * from jsonb_array_elements(deferred_team) loop
    v_entity := (r->>'entity')::uuid; v_url := r->>'url'; v_person := null;
    select p.id into v_person from catalog_people p
     where p.entity_id = v_entity
       and lower(v_url) like '%' || replace(lower(public.normalize_person_name(p.full_name)), ' ', '-') || '%'
     limit 1;
    if v_person is null then
      select p.id into v_person from catalog_people p
       where p.entity_id = v_entity and lower(v_url) like '%' || lower(split_part(p.full_name, ' ', 1)) || '%' limit 1;
    end if;
    if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is not distinct from v_person and source_url = v_url) then
      insert into catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, quality, supports, verified_at, batch_id, notes)
      values (v_entity, v_person, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'person_affiliation', v_verified_on, v_batch, 'Given as Fonte_Equipa; a person profile, so a person source (640 §3.1)');
      c_src_inserted := c_src_inserted + 1;
    else c_src_existing := c_src_existing + 1; end if;
  end loop;

  -- ============================================================= contents
  for r in select * from jsonb_array_elements(coalesce(p_payload->'hooks', '[]'::jsonb)) loop
    v_entity := (ent_map->>(r->>'ID_Investidor'))::uuid;
    v_person := (per_map->>(r->>'ID_Pessoa'))::uuid;
    v_url := nullif(btrim(r->>'URL_Fonte'), '');
    if v_entity is null or v_url is null then c_src_unresolved := c_src_unresolved + 1; continue; end if;
    hook_map := hook_map || jsonb_build_object(r->>'ID_Hook', jsonb_build_object('entity', v_entity, 'person', v_person));
    v_txt := concat_ws(' · ',
               '[' || coalesce(nullif(btrim(r->>'Tipo_Conteúdo'), ''), 'Conteúdo') || '] ' || coalesce(nullif(btrim(r->>'Título'), ''), '(sem título)'),
               case when nullif(btrim(r->>'Tema'), '') is not null then 'Tema: ' || btrim(r->>'Tema') end,
               case when nullif(btrim(r->>'Ponto_de_Vista'), '') is not null then 'PdV: ' || btrim(r->>'Ponto_de_Vista') end,
               case when nullif(btrim(r->>'Hook_Sugerido'), '') is not null then 'Hook: ' || btrim(r->>'Hook_Sugerido') end,
               case when nullif(btrim(r->>'Nota_de_Uso'), '') is not null then 'Uso: ' || btrim(r->>'Nota_de_Uso') end);
    v_pub := nullif(btrim(r->>'Data_Publicação'), '');
    select id into v_aff from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is not distinct from v_person and source_url = v_url limit 1;
    if v_aff is null then
      insert into catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, quality, supports, verified_at, published_at, batch_id, notes)
      values (v_entity, v_person, v_url, 'manual_research', 'read_full_text', 'hook', v_verified_on, v_pub, v_batch, v_txt);
      c_contents := c_contents + 1; c_src_inserted := c_src_inserted + 1;
    else
      update catalog_entity_enrichment_sources set quality = 'read_full_text', supports = 'hook', published_at = coalesce(published_at, v_pub), notes = coalesce(notes, v_txt), batch_id = case when batch_id like 'base_investidores%' then batch_id else batch_id end where id = v_aff;
      c_contents := c_contents + 1; c_src_existing := c_src_existing + 1;
    end if;
  end loop;

  -- ============================================================== signals
  for r in select * from jsonb_array_elements(coalesce(p_payload->'signals', '[]'::jsonb)) loop
    v_entity := (ent_map->>(r->>'ID_Investidor'))::uuid;
    v_person := (per_map->>(r->>'ID_Pessoa'))::uuid;
    if v_person is null then c_src_unresolved := c_src_unresolved + 1; continue; end if;
    sig_map := sig_map || jsonb_build_object(r->>'ID_Sinal', jsonb_build_object('entity', v_entity, 'person', v_person));
    v_txt := concat_ws(' — ', nullif(btrim(r->>'Sinal_Público'), ''), nullif(btrim(r->>'Hook_Seguro'), ''));
    if coalesce(r->>'net_rejected', 'false') = 'true' then
      c_signals_rejected := c_signals_rejected + 1;
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (v_admin, 'special_category_field_rejected', 'catalog_person', v_person,
              jsonb_build_object('path', 'import', 'field', 'watch_outs', 'term', r->>'net_term', 'marker', r->>'net_marker', 'batch', v_batch, 'file_id', r->>'ID_Sinal'));
      continue;
    end if;
    if v_txt is not null and v_txt <> '' then
      update catalog_people_research
         set watch_outs = case when watch_outs is null or watch_outs = '' then v_txt when position(v_txt in watch_outs) = 0 then v_txt || E'\n' || watch_outs else watch_outs end,
             verified_fields = verified_fields || jsonb_build_object('watch_outs', 'verified_by_admin'),
             updated_at = now()
       where person_id = v_person;
      c_signals := c_signals + 1;
    end if;
    v_url := nullif(btrim(r->>'URL_Fonte'), '');
    if v_url is not null and v_entity is not null then
      if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id = v_person and source_url = v_url) then
        insert into catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, quality, supports, verified_at, batch_id, notes)
        values (v_entity, v_person, v_url, 'manual_research', 'domain_verified_not_full_text_read', 'watch_outs', v_verified_on, v_batch, 'Sinal pessoal: ' || coalesce(r->>'Categoria', ''));
        c_src_inserted := c_src_inserted + 1;
      else c_src_existing := c_src_existing + 1; end if;
    end if;
  end loop;

  -- ============================================================== sources
  for r in select * from jsonb_array_elements(coalesce(p_payload->'sources', '[]'::jsonb)) loop
    v_url := nullif(btrim(r->>'URL'), '');
    v_reg := btrim(r->>'ID_Registo');
    v_prova := r->>'Prova_Para';
    if v_url is null then c_src_unresolved := c_src_unresolved + 1; continue; end if;
    v_entity := null; v_person := null;
    if v_reg like 'INV%' then
      v_entity := (ent_map->>v_reg)::uuid;
    elsif v_reg like 'PER%' then
      v_person := (per_map->>v_reg)::uuid;
      if v_person is not null then select entity_id into v_entity from catalog_people where id = v_person; end if;
    elsif v_reg like 'HOK%' then
      v_entity := (hook_map->v_reg->>'entity')::uuid; v_person := (hook_map->v_reg->>'person')::uuid;
    elsif v_reg like 'SIG%' then
      v_entity := (sig_map->v_reg->>'entity')::uuid; v_person := (sig_map->v_reg->>'person')::uuid;
    end if;
    if v_entity is null then c_src_unresolved := c_src_unresolved + 1; continue; end if;
    -- a person's LinkedIn profile never becomes an entity fact; as a source it is fine
    v_txt := lower(coalesce(r->>'Tipo_Fonte', ''));
    v_supports := case
      when v_txt like 'tese%' then 'thesis'
      when v_txt = 'equipa' then 'team'
      when v_txt like 'perfil / equipa%' or v_txt like 'perfil oficial%' or v_txt = 'perfil' then 'person_affiliation'
      when v_txt like 'sinal%' then 'watch_outs'
      when v_txt like 'email%' then 'email'
      when v_txt like 'cargo%' then 'title'
      when v_txt like 'sede%' then 'hq'
      when v_prova = 'Conteúdo / hook' or v_txt ~ 'artigo|entrevista|publica|declara|podcast|livro|q&a|confer' then 'hook'
      else left(v_txt, 60) end;
    if not exists (select 1 from catalog_entity_enrichment_sources where entity_id = v_entity and person_id is not distinct from v_person and source_url = v_url) then
      insert into catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, quality, supports, verified_at, batch_id, notes)
      values (v_entity, v_person, v_url, 'manual_research', 'domain_verified_not_full_text_read', v_supports,
              coalesce(nullif(btrim(r->>'Data_Verificação'), '')::date, v_verified_on), v_batch,
              nullif(concat_ws(' · ', nullif(btrim(r->>'Tipo_Fonte'), ''), nullif(btrim(r->>'Notas'), '')), ''));
      c_src_inserted := c_src_inserted + 1;
    else
      c_src_existing := c_src_existing + 1;
    end if;
  end loop;

  alter table public.catalog_entities enable trigger catalog_entities_verified_event;

  report := jsonb_build_object(
    'batch', v_batch, 'dry_run', p_dry_run,
    'entities', jsonb_build_object('updated', c_ent_updated, 'created', c_ent_created, 'fields_written', c_ent_fields, 'conflicts', c_conflicts, 'renamed', c_renamed, 'demo_promoted', c_demo_promoted),
    'people', jsonb_build_object('created', c_ppl_created, 'updated', c_ppl_updated, 'affiliated', c_ppl_affiliated, 'linkedin_written', c_linkedin_person, 'linkedin_skipped_duplicate', c_linkedin_person_skipped),
    'hooks', jsonb_build_object('written', c_hooks_written, 'not_written_base', c_hooks_base, 'enriched_or_partial_without_hook', c_hooks_empty),
    'contents', jsonb_build_object('inserted_or_updated', c_contents),
    'signals', jsonb_build_object('written', c_signals, 'rejected_by_net', c_signals_rejected),
    'sources', jsonb_build_object('inserted', c_src_inserted, 'already_existed', c_src_existing, 'unresolved', c_src_unresolved),
    'team_page_url_written', c_team_page,
    'linkedin_urls_kept_out_of_website_and_team_page', c_linkedin_kept_out,
    'currencies_converted', c_fx,
    'stages_unrecognised', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from unnest(unknown_stages) x),
    'countries_unrecognised', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from unnest(unknown_countries) x),
    'sectors', jsonb_build_object('raw_terms', (select count(distinct x) from unnest(sector_raw) x), 'normalised_terms', (select count(distinct x) from unnest(sector_norm) x)),
    'conflicts_detail', conflicts,
    'team_page_url_total_after', (select count(*) from catalog_entities where team_page_url is not null)
  );

  if p_dry_run then
    raise exception 'DRY_RUN %', report::text;
  end if;
  return report;
end $fn$;

revoke all on function public.import_investor_base(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_investor_base(text, jsonb, boolean) to service_role;

comment on function public.import_investor_base(text, jsonb, boolean) is
  'Prompt 639 §3 / 640 — imports a human-verified investor base (investors, people, hooks, signals, sources as JSON). Idempotent on natural keys. p_dry_run=true runs everything and raises DRY_RUN <report> so nothing persists. Called from scripts/import-investor-base.mjs with the service role.';
