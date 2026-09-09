-- Prompt 632 §2.1 — one normaliser per kind of field, because one for
-- everything was the reason no two values have ever matched.
--
-- Measured 2026-09-09, before touching anything: 754 contributions, 336
-- subjects, and ZERO (subject, field) pairs where two orgs wrote the same
-- value — under the current normaliser, which is lower(btrim()). Against
-- Nuno's own three examples it fails all three: "António Racel" vs
-- "Antonio Rassel" (accent, spelling), "223123321" vs "223 123 321" (inner
-- spaces), "22 3123321" vs "223 123 321". catalog_person_name_key does not
-- fold accents either. So the engine could not have found agreement even
-- with two orgs — and there has only ever been one.
--
-- Extensions: neither was installed (both available, unaccent 1.1 / pg_trgm
-- 1.6). Supabase puts them in the `extensions` schema; every call below
-- qualifies it so the functions do not depend on the caller's search_path.
--
-- IMMUTABLE, with one honest caveat. unaccent() is STABLE because its
-- dictionary can change; the two-argument form with a literal dictionary
-- name is the accepted way to wrap it as immutable for indexing. If the
-- dictionary is ever swapped, expression indexes on these would need a
-- REINDEX — there are none today.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- phone
-- Digits only, international prefix resolved. Nuno's three examples —
-- 223123321 / 223 123 321 / 22 3123321 — and +351 223 123 321 /
-- 00351223123321 all collapse to 223123321.
--
-- A small prefix table rather than a hard-coded 351, per 632's own note:
-- the catalogue is European, so the European calling codes are listed and
-- the longest matching prefix is stripped. A number whose prefix is not
-- listed keeps its full digits — better than guessing which country's
-- national number to cut it to. Same-digits-different-country collisions are
-- accepted: two orgs writing the same nine digits for the same firm's phone
-- are agreeing, whatever the country.
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  with d as (
    select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as digits
  ),
  cc as (
    select unnest(array['351','34','33','49','44','31','41','46','45','358','47','353','32','39','43','352','48','30','420','36','40','359','385','386','421','372','371','370','354','356','357','1','55']) as code
  ),
  stripped as (
    select d.digits,
           (select cc.code from cc, d where d.digits like cc.code || '%' and length(d.digits) > length(cc.code) + 6
              order by length(cc.code) desc limit 1) as matched
    from d
  )
  select case
    when digits = '' then null
    when matched is not null then substr(digits, length(matched) + 1)
    else digits
  end
  from stripped;
$$;

-- ----------------------------------------------------------------- name
-- Accents folded, punctuation out, word order irrelevant, so "António
-- Racel" and "Racel, António" both become "antonio racel".
--
-- "Antonio Rassel" becomes "antonio rassel" and does NOT match — on purpose.
-- A different consonant may be a typo or may be a different person, and an
-- immutable function has no way to know. That case is §2.1b's job:
-- similarity() proposes a review item; it never counts as agreement.
create or replace function public.normalize_person_name(p text)
returns text language sql immutable as $$
  select nullif(
    (select string_agg(w, ' ' order by w)
       from unnest(string_to_array(
         regexp_replace(lower(extensions.unaccent('extensions.unaccent', btrim(coalesce(p, '')))), '[^a-z0-9 ]', ' ', 'g'),
         ' ')) w
      where w <> ''),
    '');
$$;

-- ------------------------------------------------------------------ url
-- Scheme, www., trailing slash and fragment removed; case-folded on the host
-- only (paths can be case-sensitive, but for "is this the same site" the
-- whole thing is folded — a founder pasting Buenavistaequity.pt/#ethos and
-- another pasting buenavistaequity.pt are agreeing). LinkedIn URLs keep
-- using catalog_normalize_linkedin_url, which already knows LinkedIn's own
-- variants; this is for websites and team pages.
create or replace function public.normalize_url(p text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p, ''))), '^https?://', ''),
        '^www\.', ''),
      '[#?].*$|/+$', '', 'g'),
    '');
$$;

-- ------------------------------------------------------- short text / email
create or replace function public.normalize_short_text(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(extensions.unaccent('extensions.unaccent', btrim(coalesce(p, '')))), '\s+', ' ', 'g'), '');
$$;

-- -------------------------------------------------------------- dispatcher
-- The normaliser is chosen by the FIELD, not by the caller. Arrays (sectors,
-- geographies, key_people) are normalised element-wise, sorted and joined,
-- so order never matters — the same shape catalog_person_normalize_value
-- already had for arrays.
create or replace function public.catalog_normalize_for_field(p_field text, p_value jsonb)
returns text language sql immutable as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) = 'array' then nullif((
      select string_agg(n, '|' order by n)
        from (select public.catalog_normalize_for_field(p_field, to_jsonb(e)) as n
                from jsonb_array_elements_text(p_value) e) x
       where n is not null), '')
    when p_field in ('phone') then public.normalize_phone(p_value #>> '{}')
    when p_field in ('hq_country') then public.normalize_country_code(p_value #>> '{}')
    when p_field in ('website', 'team_page_url', 'submission_channel') then public.normalize_url(p_value #>> '{}')
    when p_field in ('linkedin_url') then public.catalog_normalize_linkedin_url(p_value #>> '{}')
    when p_field in ('key_people', 'role', 'name') then public.normalize_person_name(p_value #>> '{}')
    when p_field in ('email', 'email_domain', 'general_partner_emails') then lower(btrim(p_value #>> '{}'))
    when p_field in ('check_min_eur', 'check_max_eur', 'aum') then nullif(regexp_replace(p_value #>> '{}', '[^0-9.]', '', 'g'), '')
    else public.normalize_short_text(p_value #>> '{}')
  end;
$$;

comment on function public.catalog_normalize_for_field(text, jsonb) is
  'Prompt 632 §2.1 — the one place a contribution value becomes comparable. Picks the normaliser by field: phone digits, ISO-2 country, host/path for URLs, accent-folded sorted words for names, lower/trim for e-mail, unaccented collapsed text otherwise; arrays element-wise, order-independent.';
