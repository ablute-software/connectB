-- Prompt I-01c §B — the class is "ecosystem organisations", not only
-- incubators/accelerators: Startup Portugal, IAPMEI, a regional association or
-- a technology-transfer office are the same kind of partner. `incubator` stays
-- the TECHNICAL name of the class (tables, functions, routes, the role) — only
-- the user-facing label changes (DECISIONS.md, 30/09/2026).
--
-- NOT applied by the session that wrote it; apply only with Nuno's "sim", and
-- rename the file to the version apply_migration records.
--
-- New kinds: public_agency, association, tech_transfer_office.
--
-- One addition beyond "only the check": incubator_update_profile() validates
-- `kind` against its own copy of the list, so without the same widening there
-- an owner could never choose one of the new kinds from Settings. Same body as
-- 20260930144202_incubators_foundation.sql, only the list changes.

alter table public.incubators drop constraint if exists incubators_kind_check;
alter table public.incubators add constraint incubators_kind_check check (kind in (
  'municipal', 'university', 'private_accelerator', 'corporate', 'pre_incubation',
  'public_agency', 'association', 'tech_transfer_office', 'other'
));
comment on table public.incubators is
  'Prompt I-01 — an ecosystem organisation (incubator, accelerator, public agency, association, tech-transfer office…). "incubator" is the technical name of the class. Deliberately not a row in orgs.';

create or replace function public.incubator_update_profile(
  p_incubator_id uuid, p_name text, p_kind text, p_website text, p_city text, p_logo_url text, p_description text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_incubator_owner(p_incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if p_kind not in ('municipal', 'university', 'private_accelerator', 'corporate', 'pre_incubation',
                    'public_agency', 'association', 'tech_transfer_office', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;
  update incubators
    set name = btrim(p_name), kind = p_kind, website = nullif(btrim(p_website), ''),
        city = nullif(btrim(p_city), ''), logo_url = nullif(btrim(p_logo_url), ''),
        description = nullif(btrim(p_description), '')
    where id = p_incubator_id;
  return jsonb_build_object('ok', true);
end $$;
-- create or replace keeps the existing ACL (revoked from public/anon, granted
-- to authenticated by the foundation migration); re-stated so a schema replay
-- from this file alone still ends in the same place.
revoke execute on function public.incubator_update_profile(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.incubator_update_profile(uuid, text, text, text, text, text, text) to authenticated;
