-- Fix for a Supabase advisor WARN (function_search_path_mutable) found
-- immediately after applying 0328: this one function was missing the
-- `set search_path = public` every other function in that migration
-- correctly declared. Low practical risk (the body only manipulates its
-- own jsonb argument via fully-qualified built-ins, no unqualified table
-- references to hijack) but cheap and correct to close for consistency.
create or replace function public.catalog_person_normalize_value(v jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(v) = 'array' then (
      select string_agg(lower(btrim(elem)), '|' order by lower(btrim(elem)))
      from jsonb_array_elements_text(v) as elem
    )
    else lower(btrim(v #>> '{}'))
  end;
$$;
