-- Prompt 585 §I — GDPR erase extension for the three tables this prompt
-- added across Phases 1/2/4: catalog_evidence, hook_suggestions,
-- catalog_person_priority. contact_outcomes needs no change — it already
-- "mantém só ids" (§I's own words): no name/content field was ever
-- stored on it, and person_id is already `on delete set null` (0349).
--
-- Two real schema adjustments, both forced by facts checked against the
-- live schema before writing this, not assumed:
--
-- 1. catalog_evidence.person_id was `on delete cascade` (0344). §I wants
--    a SOFT erase for this table specifically — "status='erased',
--    url/excerpt/title a null" — i.e. the row survives; cascade-deleting
--    it the moment catalog_people is deleted would destroy it instead.
--    Changed to `on delete set null`, so the soft-erase this migration's
--    own extension to erase_gdpr_person() performs happens FIRST (while
--    person_id is still set), and the cascade that follows a few lines
--    later (deleting the catalog_people row itself) only ever nulls the
--    now-dangling pointer on an already-erased row.
-- 2. That requires widening catalog_evidence_check (person_id is not
--    null or entity_id is not null) — a person-only evidence row with
--    person_id nulled by the cascade above would otherwise violate it.
--    Widened to also allow status='erased' with both null.
--
-- `title` and `url` stay NOT NULL — an unrelated, pre-existing
-- constraint this prompt doesn't touch — so neither can literally become
-- SQL null despite §I's own "a null" wording. The SAME
-- erase_gdpr_person() already sets people.full_name to the placeholder
-- '[erased on request]' for exactly this reason (that column is also
-- NOT NULL); this migration follows that already-established norm for
-- title. url gets a DIFFERENT placeholder, not the same literal string
-- reused: url feeds two GENERATED STORED columns (source_domain,
-- content_hash — content_hash is the target of a UNIQUE index), so a
-- second evidence row from the same person erased with the same
-- (now-identical) excerpt would collide on content_hash the moment two
-- placeholder urls were byte-identical. `https://erased.invalid/<row id>`
-- is unique per row (the id is a PK) and uses RFC 2606's `.invalid` TLD,
-- reserved precisely for "an address guaranteed never to resolve" —
-- never a page a UI or a person could ever load by accident.
alter table public.catalog_evidence drop constraint catalog_evidence_person_id_fkey;
alter table public.catalog_evidence add constraint catalog_evidence_person_id_fkey
  foreign key (person_id) references public.catalog_people(id) on delete set null;

alter table public.catalog_evidence drop constraint catalog_evidence_check;
alter table public.catalog_evidence add constraint catalog_evidence_check
  check (person_id is not null or entity_id is not null or status = 'erased');

-- catalog_person_priority.person_id is already `on delete cascade`
-- (0345) — confirmed against the live schema before writing this, so
-- "catalog_person_priority da pessoa apagada" (§I) already happens for
-- free once catalog_people is deleted below; no code needed for it, only
-- a count captured (before the cascade fires) for this function's own
-- report.
create or replace function public.erase_gdpr_person(p_claimant_email text, p_admin_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email text;
  v_ids uuid[];
  v_org_count int;
  v_catalog_ids uuid[];
  v_catalog_rows int := 0;
  v_research_rows int := 0;
  v_suppressed int := 0;
  v_evidence_rows int := 0;
  v_evidence_tags int := 0;
  v_hooks_invalidated int := 0;
  v_priority_rows int := 0;
begin
  if coalesce(btrim(p_claimant_email), '') = '' then
    raise exception 'a claimant email is required to erase';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to erase';
  end if;

  v_email := lower(btrim(p_claimant_email));

  select array_agg(id), count(distinct org_id) into v_ids, v_org_count
  from public.people where lower(btrim(email_verified)) = v_email;

  if v_ids is not null and array_length(v_ids, 1) is not null then
    update public.people set
      full_name = '[erased on request]', email_verified = null, phone = null, linkedin_url = null,
      linked_companies = '{}', linked_funds = '{}', do_not_contact = true
    where id = any(v_ids);
  end if;

  select array_agg(r.person_id) into v_catalog_ids
  from public.catalog_people_research r
  where lower(btrim(coalesce(r.email_verified, ''))) = v_email
     or lower(btrim(coalesce(r.email_guess, ''))) = v_email;

  if v_catalog_ids is not null and array_length(v_catalog_ids, 1) is not null then
    -- Prompt 585 §I — soft-erase this person's own evidence, before the
    -- catalog_people delete below (which would otherwise null person_id
    -- via the FK change above, satisfied here already by status='erased').
    update public.catalog_evidence
    set status = 'erased', url = 'https://erased.invalid/' || id::text, title = '[erased on request]', excerpt = null
    where person_id = any(v_catalog_ids) and status <> 'erased';
    get diagnostics v_evidence_rows = row_count;

    -- "tags apagadas"
    delete from public.catalog_evidence_topics
    where evidence_id in (select id from public.catalog_evidence where person_id = any(v_catalog_ids));
    get diagnostics v_evidence_tags = row_count;

    -- hook_suggestions targeting this person directly. Evidence-citing
    -- hooks are NOT handled here — they're already invalidated as a side
    -- effect of the catalog_evidence status update just above: that
    -- update sets status = 'erased', which is exactly one of the two
    -- statuses (0348's trg_hook_suggestions_invalidate trigger, from
    -- Phase 4) already watches for. Confirmed live before finalizing
    -- this migration (see DECISIONS.md) — a first attempt updated BOTH
    -- conditions here and undercounted in its own return value, because
    -- the trigger had already claimed the evidence-citing row (leaving
    -- `where invalidated_at is null` unable to see it) by the time this
    -- statement ran; not a correctness bug — both rows really were
    -- invalidated — but a misleading number in the function's own
    -- report, fixed by not fighting the trigger for rows it already owns
    -- and counting the true total separately below.
    update public.hook_suggestions
    set invalidated_at = now(), invalidated_reason = 'person_erased', hook_text = null
    where invalidated_at is null and target_kind = 'person' and target_id = any(v_catalog_ids);

    select count(*) into v_hooks_invalidated
    from public.hook_suggestions
    where invalidated_at is not null
      and (
        (target_kind = 'person' and target_id = any(v_catalog_ids))
        or evidence_ids && coalesce(
             (select array_agg(id) from public.catalog_evidence where person_id = any(v_catalog_ids)),
             '{}'::uuid[])
      );

    -- Counted here, before the cascade a few lines below removes them.
    select count(*) into v_priority_rows from public.catalog_person_priority where person_id = any(v_catalog_ids);

    insert into public.catalog_person_suppressions (linkedin_url_normalized, name_key, entity_id, reason, origin, requested_by)
    select cp.linkedin_url_normalized,
           case when cp.linkedin_url_normalized is null then public.catalog_person_name_key(cp.full_name) end,
           cp.entity_id, p_reason, 'gdpr_erase', p_admin_id
    from public.catalog_people cp
    where cp.id = any(v_catalog_ids)
    on conflict do nothing;
    get diagnostics v_suppressed = row_count;

    delete from public.catalog_people_research where person_id = any(v_catalog_ids);
    get diagnostics v_research_rows = row_count;

    delete from public.catalog_people where id = any(v_catalog_ids);
    get diagnostics v_catalog_rows = row_count;
  end if;

  return jsonb_build_object(
    'people_rows', coalesce(array_length(v_ids, 1), 0),
    'orgs_affected', coalesce(v_org_count, 0),
    'catalog_people_rows', v_catalog_rows,
    'catalog_research_rows', v_research_rows,
    'suppressions_added', v_suppressed,
    'evidence_rows_erased', v_evidence_rows,
    'evidence_tags_deleted', v_evidence_tags,
    'hook_suggestions_invalidated', v_hooks_invalidated,
    'person_priority_rows_removed', v_priority_rows,
    'erased_at', now(), 'erased_by', p_admin_id, 'reason', p_reason
  );
end;
$function$;

revoke all on function public.erase_gdpr_person(text, uuid, text) from public, anon, authenticated;
grant execute on function public.erase_gdpr_person(text, uuid, text) to service_role;
