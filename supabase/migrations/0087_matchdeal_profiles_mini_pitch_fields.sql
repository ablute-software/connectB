-- Prompt 98 §5/§6 — mini-pitch Slide 3 (Market) and Slide 4 (Traction) fields.
-- tam_eur is the only one treated as "required to count" for slide
-- completeness — that's an application-layer rule (ProfilePanel's
-- completeness list), not enforced here, since a genuinely-not-yet-filled
-- profile is a valid DB state, just an incomplete one.
alter table public.matchdeal_profiles
  add column tam_eur numeric,
  add column sam_eur numeric,
  add column som_eur numeric,
  add column revenue_projection_12mo_eur numeric,
  add column revenue_projection_5yr_eur numeric,
  add column traction_metrics jsonb not null default '[]'::jsonb;

-- Postgres forbids a bare subquery inside a CHECK expression, so the
-- validation lives in a small IMMUTABLE helper instead. Structural
-- integrity only: must be a JSON array, and every element's "type" must be
-- one of the fixed menu options (+ 'other' escape hatch) with a non-null
-- "value" — keeps Slide 4 rendering uniform instead of a free-text blob.
create or replace function public.matchdeal_valid_traction_metrics(p_metrics jsonb)
returns boolean
language sql
immutable
as $function$
  select jsonb_typeof(p_metrics) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_metrics) elem
      where (elem->>'type') not in ('mrr_arr','growth_rate','paying_customers','lois_pilots','waitlist','partnerships','other')
         or (elem->>'value') is null
    );
$function$;

alter table public.matchdeal_profiles
  add constraint matchdeal_profiles_traction_metrics_check
  check (public.matchdeal_valid_traction_metrics(traction_metrics));
