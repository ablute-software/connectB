-- Prompt 585 Phase 3 — the founder "propose evidence" write path (§D.3)
-- and its 3-org URL consensus (§D.3's own line: "3 orgs não-test com a
-- mesma url normalizada → verified automático").
--
-- DEVIATION FROM THE PROMPT'S LITERAL TEXT, disclosed here: §D.3 says to
-- create "uma contribution catalog_person para reutilizar o consenso" —
-- i.e. ride the existing generic `contributions` table + its
-- `catalog_person_check_consensus()` trigger (0322/0328/0336) and, on
-- reaching 3 orgs, call `catalog_person_apply_field()`. That function's
-- whole job is to WRITE A VALUE ONTO A CATALOG_PEOPLE/CATALOG_PEOPLE_RESEARCH
-- FIELD (hook, background, linkedin_url, ...) — it has no way to "apply"
-- an evidence row, and misusing it here would either silently do nothing
-- useful or corrupt an unrelated field. `contributions.subject_type` is
-- also hardcoded to 'catalog_person' inside that trigger, so a literal
-- reuse would need every evidence proposal to smuggle its URL through a
-- field/value shape built for single-field claims, not evidence rows.
--
-- Built instead: a parallel, purpose-built consensus mechanism directly on
-- catalog_evidence, with the exact same externally observable behaviour
-- the prompt asks for (3 distinct non-test/non-internal orgs proposing
-- the same normalized URL for the same person/entity → auto-verified,
-- audited) — see `catalog_evidence_consensus_check()` below. The admin
-- approve/reject action (§G.1) is likewise its own route operating
-- directly on catalog_evidence, modeled 1:1 on the existing
-- `/api/backoffice/catalog/people/[id]/quarantine` route's shape
-- (requirePlatformAdmin + logAdminAction with a from/to detail), rather
-- than folded into the person-field quarantine queue.

-- ============================================================
-- URL normalization — used both to store a canonical `url` on insert
-- (the table's own comment already calls the stored url "caller-
-- normalized") and to compare across orgs for consensus. Deliberately
-- simple: lowercase, strip scheme, strip a trailing slash, strip the
-- query string entirely (tracking params vary too much across who
-- copy-pasted the link to be worth parsing individually).
-- ============================================================
create or replace function public.catalog_evidence_normalize_url(p_url text)
returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(regexp_replace(trim(p_url), '^[a-zA-Z]+://', ''), '[?#].*$', ''), '/+$', ''));
$$;

revoke all on function public.catalog_evidence_normalize_url(text) from public;
grant execute on function public.catalog_evidence_normalize_url(text) to authenticated, service_role;

-- The propose route (service role) needs to tag on insert — this function
-- was written in migration 0344 with no explicit grant beyond the
-- superuser context the one-time backfill ran under. Now that a real
-- writer exists, it needs a real grant.
grant execute on function public.catalog_tag_evidence_dictionary(uuid) to service_role;

-- ============================================================
-- Consensus — fires after a founder-origin evidence row lands in
-- 'quarantined'. Counts distinct non-test/non-internal orgs that have
-- proposed (quarantined or already verified, origin='founder') evidence
-- for the same subject (person_id or entity_id, matching whichever the
-- new row carries) with the same normalized url. At >= 3, verifies every
-- matching quarantined row (each proposing org keeps its own row — this
-- is deliberately not a merge/dedup step) and writes one audit entry.
-- ============================================================
create or replace function public.catalog_evidence_consensus_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_norm text;
  v_org_count int;
  v_verified_ids uuid[];
begin
  if new.origin <> 'founder' or new.status <> 'quarantined' then
    return new;
  end if;

  v_norm := public.catalog_evidence_normalize_url(new.url);

  select count(distinct ce.created_by_org_id) into v_org_count
  from public.catalog_evidence ce
  join public.orgs o on o.id = ce.created_by_org_id
  where ce.origin = 'founder'
    and ce.status in ('quarantined', 'verified')
    and public.catalog_evidence_normalize_url(ce.url) = v_norm
    and (
      (new.person_id is not null and ce.person_id = new.person_id)
      or (new.entity_id is not null and ce.entity_id = new.entity_id)
    )
    and o.is_test = false and o.is_internal = false;

  if v_org_count < 3 then
    return new;
  end if;

  with matching as (
    select ce.id from public.catalog_evidence ce
    join public.orgs o on o.id = ce.created_by_org_id
    where ce.origin = 'founder' and ce.status = 'quarantined'
      and public.catalog_evidence_normalize_url(ce.url) = v_norm
      and (
        (new.person_id is not null and ce.person_id = new.person_id)
        or (new.entity_id is not null and ce.entity_id = new.entity_id)
      )
      and o.is_test = false and o.is_internal = false
  ),
  updated as (
    update public.catalog_evidence set status = 'verified', verified_at = now()
    where id in (select id from matching)
    returning id
  )
  select array_agg(id) into v_verified_ids from updated;

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_evidence_consensus_auto_verify', 'catalog_evidence', new.id,
    jsonb_build_object('normalized_url', v_norm, 'org_count', v_org_count, 'evidence_ids', v_verified_ids,
      'person_id', new.person_id, 'entity_id', new.entity_id));

  return new;
end;
$$;

drop trigger if exists trg_catalog_evidence_consensus_check on public.catalog_evidence;
create trigger trg_catalog_evidence_consensus_check
  after insert on public.catalog_evidence
  for each row execute function public.catalog_evidence_consensus_check();

revoke all on function public.catalog_evidence_consensus_check() from public, anon, authenticated;
