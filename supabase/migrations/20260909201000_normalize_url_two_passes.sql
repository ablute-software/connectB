-- Prompt 632 §2.1 — caught by the fixture, ten minutes after the previous file:
--
--   normalize_url('https://www.buenavistaequity.pt/#ethos')  ->  'buenavistaequity.pt/'
--
-- One regexp_replace with the alternation '[#?].*$|/+$' runs a single pass
-- over the ORIGINAL string, so after '#ethos' is removed the slash that now
-- ends the string was never a candidate for '/+$'. Two passes, in order.
-- This is precisely the Prompt 266 example (site pasted with and without a
-- trailing slash) that a URL normaliser exists for.

create or replace function public.normalize_url(p text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(p, ''))), '^https?://', ''),
          '^www\.', ''),
        '[#?].*$', ''),
      '/+$', ''),
    '');
$$;
