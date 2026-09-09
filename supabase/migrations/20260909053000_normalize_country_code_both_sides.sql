-- Prompt 627 §2 — a normalisation on one side only is not a normalisation.
--
-- `catalog_match_score` carried its own country table inline and applied it to
-- the ORG's country, then compared the result against `catalog_entities.
-- hq_country` RAW. So for a Portuguese org:
--
--     hq_country = 'PT'        -> +10
--     hq_country = 'Portugal'  -> falls through to the else -> +2
--     hq_country = null        -> +2
--
-- A Portuguese fund whose country was spelled out was scored exactly like an
-- American one. On a scale with a cut at 55, those 8 points decide.
--
-- Measured 2026-09-09, before touching anything: 230 rows would change, 426
-- are already ISO-2 and untouched, 106 are already null, and — the number
-- that made this safe to apply — ZERO rows normalise to null. Every spelled-
-- out value in the table maps to a code, so nothing is lost in translation.
-- That matches the ~230 estimate in §2.3 exactly, so no stop was needed.
--
-- THE TABLE MOVES, IT IS NOT COPIED (§2.1: "move-a para aqui e apaga-a de lá").
-- Two copies of a country map diverge inside a quarter. After this migration
-- the mapping exists in exactly one place and `catalog_match_score` calls it
-- for BOTH sides.

create or replace function public.normalize_country_code(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    -- Already a code. Upper-cased rather than trusted: 'pt' is the same
    -- country as 'PT', and this is the exact "PT + Portugal + pt" complaint.
    when length(btrim(p)) = 2 then upper(btrim(p))
    else case lower(btrim(p))
      when 'portugal' then 'PT'  when 'spain' then 'ES'   when 'españa' then 'ES'
      when 'united kingdom' then 'GB' when 'uk' then 'GB' when 'great britain' then 'GB'
      when 'germany' then 'DE'   when 'deutschland' then 'DE'
      when 'france' then 'FR'    when 'netherlands' then 'NL' when 'the netherlands' then 'NL'
      when 'switzerland' then 'CH' when 'sweden' then 'SE' when 'denmark' then 'DK'
      when 'finland' then 'FI'   when 'norway' then 'NO'  when 'ireland' then 'IE'
      when 'belgium' then 'BE'   when 'italy' then 'IT'   when 'austria' then 'AT'
      when 'luxembourg' then 'LU' when 'poland' then 'PL' when 'greece' then 'GR'
      when 'czech republic' then 'CZ' when 'czechia' then 'CZ' when 'hungary' then 'HU'
      when 'romania' then 'RO'   when 'bulgaria' then 'BG' when 'croatia' then 'HR'
      when 'slovenia' then 'SI'  when 'slovakia' then 'SK' when 'estonia' then 'EE'
      when 'latvia' then 'LV'    when 'lithuania' then 'LT' when 'iceland' then 'IS'
      when 'malta' then 'MT'     when 'cyprus' then 'CY'
      when 'united states' then 'US' when 'usa' then 'US' when 'brazil' then 'BR'
      -- Deliberately null rather than a guess. An unrecognised country is a
      -- fact we do not have; inventing one would silently move a fund's score.
      else null end
  end;
$$;

comment on function public.normalize_country_code(text) is
  'Prompt 627 §2.1 — the single country map. Was inlined in catalog_match_score and applied to one side only. ISO-3166-1 alpha-2 out, null for anything unrecognised.';

-- §2.3 — normalise what is already stored, BEFORE the constraint below can
-- reject it. Scoped so it can never blank a value: the guard requires the
-- normalised result to be non-null.
update public.catalog_entities
   set hq_country = public.normalize_country_code(hq_country)
 where hq_country is not null
   and public.normalize_country_code(hq_country) is not null
   and public.normalize_country_code(hq_country) is distinct from hq_country;

-- §2.4 — and it does not come back. Placed after the update on purpose.
do $$ begin
  alter table public.catalog_entities
    add constraint catalog_entities_hq_country_iso2
    check (hq_country is null or hq_country ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

-- §2.2 — both sides, through the one function.
create or replace function public.catalog_match_score(p_org_id uuid, p_catalog_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_org record; v_cat record; v_score int := 0;
  v_rank_org int; v_rank_min int; v_rank_max int; v_lo int; v_hi int; v_dist int;
  v_ticket numeric; v_cc text; v_ec text;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  select sectors, stage, round_min_ticket_eur, round_target_eur, country into v_org from public.orgs where id = p_org_id;
  if not found then return null; end if;
  select sectors_normalized, stage_min, stage_max, check_min_eur, check_max_eur, hq_country, verification_status
    into v_cat from public.catalog_entities where id = p_catalog_id;
  if not found or v_cat.verification_status <> 'verified' then return null; end if;

  if coalesce(array_length(v_cat.sectors_normalized,1),0) = 0 then v_score := v_score + 15;
  elsif v_cat.sectors_normalized && v_org.sectors then v_score := v_score + 35; end if;

  v_rank_org := case v_org.stage when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_min := case v_cat.stage_min when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_max := case v_cat.stage_max when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  if v_cat.stage_min is null and v_cat.stage_max is null then v_score := v_score + 12;
  elsif v_org.stage = 'other' or v_cat.stage_min = 'other' or v_cat.stage_max = 'other' then v_score := v_score + 12;
  elsif v_rank_org is null then v_score := v_score + 12;
  else
    v_lo := coalesce(v_rank_min,1); v_hi := coalesce(v_rank_max,6);
    if v_rank_org between v_lo and v_hi then v_score := v_score + 25;
    else v_dist := least(abs(v_rank_org-v_lo), abs(v_rank_org-v_hi));
      if v_dist = 1 then v_score := v_score + 10; end if; end if;
  end if;

  v_ticket := coalesce(v_org.round_min_ticket_eur, v_org.round_target_eur);
  if v_ticket is null or v_cat.check_min_eur is null or v_cat.check_max_eur is null then v_score := v_score + 10;
  elsif v_ticket between v_cat.check_min_eur and v_cat.check_max_eur then v_score := v_score + 20;
  elsif (v_ticket < v_cat.check_min_eur and v_ticket*2 >= v_cat.check_min_eur)
     or (v_ticket > v_cat.check_max_eur and v_ticket <= v_cat.check_max_eur*2) then v_score := v_score + 10; end if;

  -- Prompt 627 §2.2 — the inline table that used to sit here is gone; both
  -- sides go through normalize_country_code now. The data migration above
  -- means v_ec is already a code for every stored row, but normalising on
  -- read as well is what makes this correct for the next row someone writes
  -- through a path the constraint has not seen yet.
  v_cc := public.normalize_country_code(v_org.country);
  v_ec := public.normalize_country_code(v_cat.hq_country);
  if v_ec is not null and v_cc is not null and v_ec = v_cc then v_score := v_score + 10;
  elsif v_ec in ('GB','DE','FR','NL','CH','SE') then v_score := v_score + 6;
  elsif v_ec in ('DK','FI','NO','IE','BE','AT','IT','ES','PL','LU','GR','CZ','HU','RO','BG','HR','SI','SK','EE','LV','LT','IS','MT','CY') then v_score := v_score + 4;
  else v_score := v_score + 2; end if;
  return v_score;
end;
$fn$;
