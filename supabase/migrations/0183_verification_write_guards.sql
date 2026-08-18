-- Prompt 250 Camada 2 — server-side gate against verification writes
-- landing on real production records (the incident: interactions/
-- stage_change, real quota consumption, and deal_messages all written
-- against the same real entity, c8ff10dd-…, sherlockdeal.com, across
-- separate verification sessions).
--
-- WHY NOT orgs.is_test (0139) alone: it marks a whole ORG as internal/
-- team-owned, never a specific record within it — and even where it IS
-- set, that's the wrong granularity for `interactions`, which target one
-- `entities` row, not an org. (Checked empirically before writing this:
-- despite 0139's own backfill intending to mark org bca54499 — ablute_,
-- the team's real dogfood org, which Nuno also uses for real — is_test
-- never actually stuck in production; it reads false today. Doesn't change
-- the design, only strengthens it: there was no org-level signal to lean
-- on here even before considering granularity.) There's no is_test column
-- on entities at all (and per Prompt 243, none gets retroactively added to
-- existing ambiguous-but-real rows). The only safe, non-invented signal is
-- a NAME a fixture is deliberately given for this purpose — formalised
-- here for the first time as `zz-test-%` (case-insensitive prefix),
-- matching the informal convention verification sessions already reach
-- for.
--
-- WHY NOT a session GUC (`SET LOCAL ...`) checked by a trigger: the
-- existing ad-hoc verification scripts (scripts/_verify_*.mjs, _check_*.mjs,
-- …) write via @supabase/supabase-js, i.e. PostgREST — every `.from(...)`
-- call is its own request/transaction, with no guaranteed connection
-- affinity to a prior `SET LOCAL`. A GUC set in one call would not reliably
-- apply to a following insert. Chosen instead: dedicated SECURITY DEFINER
-- functions that check the target AND perform the write in the SAME
-- function body — atomic by construction, no cross-call state assumed.
-- Same shape already established in this codebase for admin mutations
-- (set_org_is_test / set_catalog_entity_is_test, migration 0141): revoked
-- from public/anon/authenticated, callable only by service_role (or,
-- belt-and-suspenders like 0141, a platform admin).
--
-- WHAT THIS DOES NOT COVER (documented, not silently dropped): a live
-- browser click against a real Supabase-backed server (the third vector
-- from the original incident) still writes through the app's OWN routes
-- unchanged — those never call these functions, by design, so nothing
-- here touches Nuno's real usage or any existing route. Prompt 250 Layer 1
-- (`npm run dev:verify`) is what closes that vector, by removing the real
-- Supabase connection from verification sessions entirely; this migration
-- is the second, independent layer for the residual case of ad-hoc
-- scripts/direct-SQL verification that DOES need a real connection.
--
-- Scope: the four tables the actual incident touched. Not a general
-- write-blocking framework — extend by adding one more function in the
-- same shape if a future incident finds a fifth vector, rather than
-- generalising ahead of a second real case.

create or replace function public.verification_insert_interaction(
  p_org_id uuid, p_entity_id uuid, p_direction direction, p_channel channel, p_content text,
  p_person_id uuid default null, p_classification classification default null,
  p_pass_reason_category pass_reason_category default null, p_pass_reason text default null,
  p_occurred_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_entity_name text;
  v_id uuid;
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select name into v_entity_name from public.entities where id = p_entity_id and org_id = p_org_id;
  if v_entity_name is null then
    raise exception 'verification_insert_interaction: entity % not found in org %', p_entity_id, p_org_id;
  end if;
  if v_entity_name !~* '^zz-test-' then
    raise exception 'verification_insert_interaction: entity "%" is not a zz-test-* fixture — refusing to write a verification interaction against it', v_entity_name;
  end if;

  insert into public.interactions
    (org_id, entity_id, person_id, direction, channel, content, classification, pass_reason_category, pass_reason, occurred_at)
  values
    (p_org_id, p_entity_id, p_person_id, p_direction, p_channel, p_content, p_classification, p_pass_reason_category, p_pass_reason, p_occurred_at)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.verification_insert_interaction(uuid, uuid, direction, channel, text, uuid, classification, pass_reason_category, text, timestamptz) from public, anon, authenticated;

-- Get-or-create, mirroring deal_threads' own unique(startup_org_id,
-- investor_catalog_entity_id) — a verification script needing a thread to
-- post into should never be able to accidentally create a second one.
create or replace function public.verification_get_or_create_deal_thread(
  p_startup_org_id uuid, p_investor_catalog_entity_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org_ok boolean;
  v_catalog_ok boolean;
  v_id uuid;
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select (is_test or name ilike 'zz-test-%') into v_org_ok from public.orgs where id = p_startup_org_id;
  select (is_test or name ilike 'zz-test-%') into v_catalog_ok from public.catalog_entities where id = p_investor_catalog_entity_id;
  -- Both sides, not either: a test message thread visible to a REAL
  -- counterparty on the other end is the same problem as a real one
  -- polluted by a fake — a message always has two readers.
  if v_org_ok is not true or v_catalog_ok is not true then
    raise exception 'verification_get_or_create_deal_thread: org % / catalog entity % is not a zz-test-*/is_test fixture on both sides', p_startup_org_id, p_investor_catalog_entity_id;
  end if;

  select id into v_id from public.deal_threads
    where startup_org_id = p_startup_org_id and investor_catalog_entity_id = p_investor_catalog_entity_id;
  if v_id is null then
    insert into public.deal_threads (startup_org_id, investor_catalog_entity_id)
    values (p_startup_org_id, p_investor_catalog_entity_id)
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.verification_get_or_create_deal_thread(uuid, uuid) from public, anon, authenticated;

create or replace function public.verification_insert_deal_message(
  p_thread_id uuid, p_sender_side text, p_sender_user_id uuid, p_body text,
  p_links jsonb default '[]'::jsonb, p_document_ids uuid[] default '{}'::uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ok boolean;
  v_id uuid;
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select (o.is_test or o.name ilike 'zz-test-%') and (ce.is_test or ce.name ilike 'zz-test-%')
    into v_ok
    from public.deal_threads dt
    join public.orgs o on o.id = dt.startup_org_id
    join public.catalog_entities ce on ce.id = dt.investor_catalog_entity_id
    where dt.id = p_thread_id;
  if v_ok is not true then
    raise exception 'verification_insert_deal_message: thread % is not a zz-test-*/is_test fixture on both sides', p_thread_id;
  end if;

  insert into public.deal_messages (thread_id, sender_side, sender_user_id, body, links, document_ids)
  values (p_thread_id, p_sender_side, p_sender_user_id, p_body, p_links, p_document_ids)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.verification_insert_deal_message(uuid, text, uuid, text, jsonb, uuid[]) from public, anon, authenticated;

create or replace function public.verification_insert_catalog_delivery(
  p_org_id uuid, p_catalog_id uuid, p_entity_id uuid default null, p_via_pack uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org_ok boolean;
  v_catalog_ok boolean;
  v_id uuid;
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select (is_test or name ilike 'zz-test-%') into v_org_ok from public.orgs where id = p_org_id;
  select (is_test or name ilike 'zz-test-%') into v_catalog_ok from public.catalog_entities where id = p_catalog_id;
  if v_org_ok is not true or v_catalog_ok is not true then
    raise exception 'verification_insert_catalog_delivery: org % / catalog entity % is not a zz-test-*/is_test fixture on both sides — this would consume real catalog quota', p_org_id, p_catalog_id;
  end if;

  insert into public.catalog_deliveries (org_id, catalog_id, entity_id, via_pack)
  values (p_org_id, p_catalog_id, p_entity_id, p_via_pack)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.verification_insert_catalog_delivery(uuid, uuid, uuid, uuid) from public, anon, authenticated;
