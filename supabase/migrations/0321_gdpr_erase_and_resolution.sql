-- Prompt 574 §A — GDPR gets what it's missing: a resolver, a reason, and a
-- transactional erase. "Não apagar nada em produção... nunca chamada com
-- dados reais neste prompt" — this migration only CREATES functions; they
-- are never invoked against a real gdpr_requests/people row here, only
-- against a throwaway zz-test-* fixture (see the Prompt 574 report for the
-- exact fixture run). Both are revoked from every role but service_role,
-- same discipline as every other admin-mutation function in this codebase.
--
-- CORRECTION, same migration: this file's first version targeted
-- catalog_people, following the prompt's own example wording ("removes
-- from catalog_people (1), ..."). Checked directly before applying anything
-- further: gdpr_requests.person_id has a real FK to people(id) — the
-- private, per-org contact table, not the shared catalog. The example
-- wording doesn't match the schema; the schema (and the ALREADY-SHIPPED
-- /api/backoffice/gdpr/[id]/resolve route, which nulls people columns by
-- email match across every org) wins. Built against people below, not
-- catalog_people — see the Prompt 574 report for this discrepancy.

alter table public.gdpr_requests
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewer_notes text,
  add column if not exists resolution_method text,
  add column if not exists removal_summary jsonb;

comment on column public.gdpr_requests.resolution_method is
  'How a rectify request was closed (e.g. "rectified by <admin email>") or an erase''s method tag. Null for a request still pending, and for a reject (reviewer_notes carries the reason instead).';
comment on column public.gdpr_requests.removal_summary is
  'Set only after a successful erase — the counts returned by erase_gdpr_person, kept so the resolved row can show "what was removed" without ever storing the removed data itself.';

drop function if exists public.catalog_person_erasure_preview(uuid);
drop function if exists public.erase_catalog_person(uuid, uuid, text);

-- Prompt 574 §A.3 — the read-only half: exact counts, computed fresh at
-- decision time (never cached). people.id is never deleted (see
-- erase_gdpr_person below for why), so every count here is informational —
-- "this is the scope of what erasing this email touches" — not a promise
-- every number becomes a row removed.
create or replace function public.gdpr_erasure_preview(p_claimant_email text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
    'people_rows', (select count(*) from public.people where email_verified ilike p_claimant_email),
    'orgs_affected', (select count(distinct org_id) from public.people where email_verified ilike p_claimant_email),
    -- Informational only, never redacted: interactions are the FOUNDER's
    -- own correspondence record, not solely data about the erased person —
    -- redacting free-text content is a different, much harder problem this
    -- function does not attempt. Shown so the admin sees the real scope
    -- before confirming, per §A.3's own "números reais, calculados no
    -- momento" — never silently omitted.
    'interaction_references', (
      select count(*) from public.interactions i
      join public.people p on p.id = i.person_id
      where p.email_verified ilike p_claimant_email
    )
  );
$function$;

revoke all on function public.gdpr_erasure_preview(text) from public, anon, authenticated;
grant execute on function public.gdpr_erasure_preview(text) to service_role;

-- Prompt 574 §A.3 — the erase itself, as ONE transactional function instead
-- of the inline route logic it replaces (same effect, same table, same
-- match-by-email-across-orgs behavior as the pre-574 route — this is a
-- refactor for atomicity and a real return value, not a behavior change).
-- UPDATE, never DELETE: the person_id row stays in place (full_name cannot
-- be null; do_not_contact=true keeps it out of future outreach), which is
-- also what keeps every one of the 15 other tables with a people.id FK
-- (interactions, tasks, access_grants, ndas, ...) pointing at a row that
-- still exists — no cascade needed because nothing is actually removed,
-- only the identifying fields on it.
create or replace function public.erase_gdpr_person(p_claimant_email text, p_admin_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
  v_org_count int;
begin
  if coalesce(btrim(p_claimant_email), '') = '' then
    raise exception 'a claimant email is required to erase';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to erase';
  end if;

  select array_agg(id), count(distinct org_id) into v_ids, v_org_count
  from public.people where email_verified ilike p_claimant_email;

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('people_rows', 0, 'orgs_affected', 0);
  end if;

  update public.people set
    full_name = '[erased on request]', email_verified = null, phone = null, linkedin_url = null,
    linked_companies = '{}', linked_funds = '{}', do_not_contact = true
  where id = any(v_ids);

  return jsonb_build_object(
    'people_rows', array_length(v_ids, 1), 'orgs_affected', v_org_count,
    'erased_at', now(), 'erased_by', p_admin_id, 'reason', p_reason
  );
end;
$function$;

revoke all on function public.erase_gdpr_person(text, uuid, text) from public, anon, authenticated;
grant execute on function public.erase_gdpr_person(text, uuid, text) to service_role;
