-- Prompt 632 §2.1 — caught by the engine fixture, not by reading:
--
--   'Seed-stage SaaS in Iberia.'   'seed stage   SaaS in Iberia'   'SEED-STAGE SAAS IN IBERIA'
--
-- Three orgs, one fact, and normalize_short_text produced three different
-- strings — it folded case, accents and whitespace but left the hyphen and
-- the full stop. So the recount saw three single-org values and promoted
-- nothing, while the phone and country fields in the same run promoted
-- correctly. A trailing period is precisely the disagreement two founders
-- produce when they are agreeing.
--
-- Punctuation becomes a space, then whitespace collapses — the rule
-- normalize_person_name already applies, minus the word sort (word order
-- carries meaning in a thesis; it does not in a name).

create or replace function public.normalize_short_text(p text)
returns text language sql immutable as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(extensions.unaccent('extensions.unaccent', coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g')),
    '');
$$;
