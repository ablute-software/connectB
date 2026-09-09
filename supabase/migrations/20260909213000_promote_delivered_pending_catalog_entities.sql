-- Prompt 633 §1.3 — 401 catalogue entities were `pending` for no recorded
-- reason, and every one of them was already in somebody's pipeline.
--
-- THE CENSUS, re-measured 2026-09-09 before running: 405 pending non-test
-- entities; 401 have at least one catalog_delivery; 349 have a website, and
-- those 349 are a strict subset of the 401; 4 have neither. 355 of the 357
-- already-verified rows carry verified_by = null — July's verification was a
-- batch, not a series of decisions, and the 405 are simply where that batch
-- stopped. There is no criterion they fail.
--
-- THE CRITERION, written down so it never has to be reverse-engineered
-- again: delivered to at least one org. Stronger than "has a website" (a
-- human put it in their pipeline, which is scrutiny) and a superset of it.
-- catalog_entity_promotion_eligible() is that criterion as a function, so a
-- future entity that meets it can be promoted by routine, not by a
-- migration three months from now.
--
-- THE GUARD: the prompt expects exactly 401. If the count is anything else
-- this raises and nothing is promoted — a different number means one of us
-- is reading the table differently, and that has happened twice this week.
--
-- §4.5 — WHAT A PROMOTION FIRES, checked before running rather than after:
--   · catalog_entities_verified_event → log_investor_registered: writes an
--     analytics_events row of type 'investor_registered' per row that flips
--     to verified. There are 13 such rows in the platform's history. 401
--     more, stamped today, would make the "investors registered" metric say
--     that 30 times the platform's lifetime signups happened on 9 September.
--     They did not — nobody registered; a status was corrected. The trigger
--     is disabled for the duration of this one statement and re-enabled in
--     the same transaction.
--   · catalog_readiness_on_entity → catalog_readiness_refresh: fires on
--     submission_channel / email / key_people / enrichment_status only, not
--     on verification_status. Does not fire here.
--   · Downstream, and wanted: enqueue_cold_enrichment_batch now sees the
--     223 of these with enrichment_status = 'pending' (50 a night, ~€0.0119
--     each), catalog_match_score stops returning null for all 401, and
--     enqueue_cold_person_batch can reach the 1 349 people affiliated with
--     them (bio-only until 630's worker fix is confirmed, which it now is).
--
-- THE TRACE: verified_by stays null — no user made this decision, and
-- inventing one is worse than none. The note on the row is what the prompt
-- asked for; the admin_audit_log row per entity is the structured version of
-- the same fact, so the criterion is queryable and not only readable.

create or replace function public.catalog_entity_promotion_eligible(p_catalog_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.catalog_entities c
     where c.id = p_catalog_id
       and c.verification_status = 'pending'
       and coalesce(c.is_test, false) = false
       and exists (select 1 from public.catalog_deliveries d where d.catalog_id = c.id)
  );
$$;

comment on function public.catalog_entity_promotion_eligible(uuid) is
  'Prompt 633 §1.3.c — a pending, non-test catalogue entity that has been delivered to at least one org. Being in a founder''s pipeline is the scrutiny; a website alone is not.';

do $$
declare
  v_expected constant int := 401;
  v_eligible int;
  v_promoted int;
begin
  select count(*) into v_eligible from public.catalog_entities c where public.catalog_entity_promotion_eligible(c.id);
  if v_eligible <> v_expected then
    raise exception 'Prompt 633 §1.3.a: expected exactly % eligible entities, found % — stopping before promoting anything', v_expected, v_eligible;
  end if;

  alter table public.catalog_entities disable trigger catalog_entities_verified_event;

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  select null, 'catalog_entity_bulk_promoted', 'catalog_entity', c.id,
         jsonb_build_object('prompt', 633, 'criterion', 'pending and delivered to at least one org',
                            'previous_verification_status', c.verification_status,
                            'previous_catalog_status', c.catalog_status)
    from public.catalog_entities c
   where public.catalog_entity_promotion_eligible(c.id);

  update public.catalog_entities c
     set verification_status = 'verified',
         catalog_status      = case when c.catalog_status = 'imported' then 'verified' else c.catalog_status end,
         verified_at         = now(),
         verified_by         = null,
         notes               = trim(both ' · ' from
                                 coalesce(c.notes || ' · ', '') ||
                                 'Promovida em massa (Prompt 633): já entregue a pelo menos uma org.')
   where public.catalog_entity_promotion_eligible(c.id);
  get diagnostics v_promoted = row_count;

  alter table public.catalog_entities enable trigger catalog_entities_verified_event;

  if v_promoted <> v_expected then
    raise exception 'Prompt 633 §1.3.a: promoted % rows, expected % — rolling back', v_promoted, v_expected;
  end if;
end $$;
