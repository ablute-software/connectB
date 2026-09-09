-- Prompt 627 §2.1 — the function as specified has a bug, and it is the exact
-- bug the section exists to fix, one layer down.
--
--   when length(btrim(p)) = 2 then upper(btrim(p))
--   else case lower(btrim(p)) ... when 'uk' then 'GB' ...
--
-- The two-character shortcut is checked FIRST, so 'uk' never reaches the
-- alias map: it returns 'UK'. And 'UK' is not an ISO-3166-1 alpha-2 code —
-- the United Kingdom is 'GB'. Caught by the fixture, not by reading:
--
--   step 2, typed lowercase "uk"  ->  UK   [expected GB]
--
-- WHY IT WOULD HAVE BEEN INVISIBLE. 'UK' matches the CHECK constraint
-- (^[A-Z]{2}$), so nothing raises. It just fails every comparison: in
-- catalog_match_score, 'UK' is not in ('GB','DE','FR','NL','CH','SE'), so a
-- British fund entered as "uk" scores +2 instead of +6 — a silently foreign
-- country, which is precisely the "PT + Portugal + pt" complaint reappearing
-- as "GB + United Kingdom + uk". The same shape of defect the whole section
-- is about, reintroduced by the ordering of two CASE branches.
--
-- THE FIX IS THE ORDERING. The alias map becomes authoritative and the
-- two-letter path becomes the fallback for codes the map does not list, which
-- is the correct precedence: an explicit mapping should always beat a generic
-- rule, and there is no two-letter input the map names that we would rather
-- resolve by upper-casing.

create or replace function public.normalize_country_code(p text)
returns text language sql immutable as $$
  select case when p is null or btrim(p) = '' then null else
    coalesce(
      -- Explicit aliases first, so 'uk' -> 'GB' rather than 'UK'.
      case lower(btrim(p))
        when 'portugal' then 'PT'  when 'spain' then 'ES'   when 'españa' then 'ES'
        when 'united kingdom' then 'GB' when 'uk' then 'GB' when 'great britain' then 'GB'
        when 'england' then 'GB'   when 'scotland' then 'GB' when 'wales' then 'GB'
        when 'germany' then 'DE'   when 'deutschland' then 'DE'
        when 'france' then 'FR'    when 'netherlands' then 'NL' when 'the netherlands' then 'NL'
        when 'holland' then 'NL'
        when 'switzerland' then 'CH' when 'sweden' then 'SE' when 'denmark' then 'DK'
        when 'finland' then 'FI'   when 'norway' then 'NO'  when 'ireland' then 'IE'
        when 'belgium' then 'BE'   when 'italy' then 'IT'   when 'austria' then 'AT'
        when 'luxembourg' then 'LU' when 'poland' then 'PL' when 'greece' then 'GR'
        when 'czech republic' then 'CZ' when 'czechia' then 'CZ' when 'hungary' then 'HU'
        when 'romania' then 'RO'   when 'bulgaria' then 'BG' when 'croatia' then 'HR'
        when 'slovenia' then 'SI'  when 'slovakia' then 'SK' when 'estonia' then 'EE'
        when 'latvia' then 'LV'    when 'lithuania' then 'LT' when 'iceland' then 'IS'
        when 'malta' then 'MT'     when 'cyprus' then 'CY'
        when 'united states' then 'US' when 'usa' then 'US' when 'u.s.' then 'US'
        when 'united states of america' then 'US' when 'brazil' then 'BR' when 'brasil' then 'BR'
        else null end,
      -- Then, and only then, an unlisted two-letter code passes through.
      case when length(btrim(p)) = 2 then upper(btrim(p)) else null end
    )
  end;
$$;

comment on function public.normalize_country_code(text) is
  'Prompt 627 §2.1 — the single country map. Alias map takes precedence over the bare two-letter passthrough, so "uk" resolves to GB rather than to the non-existent code UK. Null for anything unrecognised.';

-- Nothing stored should be affected (no 'UK' rows exist), but the whole point
-- of this file is that the wrong value was silently valid, so it is checked
-- rather than assumed.
update public.catalog_entities
   set hq_country = public.normalize_country_code(hq_country)
 where hq_country is not null
   and public.normalize_country_code(hq_country) is not null
   and public.normalize_country_code(hq_country) is distinct from hq_country;
