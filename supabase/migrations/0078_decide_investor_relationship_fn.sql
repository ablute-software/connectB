-- AP-09/AP-14 — the atomic core: try to record the org's decision, and if
-- (and only if) it's a fresh 'passed' decision, revoke every access_grants
-- row for this org held by anyone on the investor's team, in the SAME
-- transaction. A Postgres function body is one transaction by default —
-- if the revoke step errors, the whole thing (including the decision
-- insert) rolls back, so "decision recorded but access left open" can't
-- happen (AP-09's "se uma parte falhar, não apresentar a decisão como
-- concluída"). Email notification is NOT in here — it's an external HTTP
-- call, can't participate in a DB transaction, and this codebase already
-- treats every transactional email as best-effort-after-the-real-write
-- (see resend.ts call sites) — the caller (the Next.js route) fires it
-- after this function returns success.
--
-- ON CONFLICT DO NOTHING is the actual concurrency guarantee AP-14's race
-- test needs: two simultaneous calls for the same (org_id,
-- investor_catalog_entity_id) can both reach this function, but the
-- unique constraint lets exactly one INSERT win — the loser sees
-- `inserted = false` and the WINNING decision in `existing_decision`,
-- never a silent overwrite.
--
-- EXECUTE intentionally revoked from anon/authenticated below: this is
-- reachable ONLY via the service-role client inside
-- /api/portal/pipeline's POST handler, which already re-validates the
-- calling investor's real access to this org (activeGrantOrgIds /
-- eligibleOrgIds) before ever calling this — a raw client RPC call would
-- skip that check entirely, so it must not be callable that way.
create or replace function public.decide_investor_relationship(
  p_org_id uuid, p_investor_catalog_entity_id uuid, p_decision text, p_reason_detail text,
  p_decided_by uuid, p_investor_emails text[]
) returns table(inserted boolean, existing_decision text, revoked_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_row investor_relationship_decisions;
  v_revoked integer := 0;
begin
  if p_decision not in ('interested', 'passed') then
    raise exception 'INVALID_DECISION';
  end if;

  insert into investor_relationship_decisions (org_id, investor_catalog_entity_id, decision, reason_detail, decided_by)
  values (p_org_id, p_investor_catalog_entity_id, p_decision, p_reason_detail, p_decided_by)
  on conflict (org_id, investor_catalog_entity_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Lost the race (or already decided earlier) — report what's there,
    -- change nothing.
    select decision into existing_decision from investor_relationship_decisions
      where org_id = p_org_id and investor_catalog_entity_id = p_investor_catalog_entity_id;
    inserted := false;
    revoked_count := 0;
    return next;
    return;
  end if;

  if p_decision = 'passed' then
    update access_grants
      set revoked_at = now()
      where org_id = p_org_id and revoked_at is null
        and (grantee_email = any(p_investor_emails) or invited_email = any(p_investor_emails));
    get diagnostics v_revoked = row_count;
    update investor_relationship_decisions set access_revoked_count = v_revoked where id = v_row.id;
  end if;

  inserted := true;
  existing_decision := p_decision;
  revoked_count := v_revoked;
  return next;
end; $$;

revoke execute on function public.decide_investor_relationship(uuid, uuid, text, text, uuid, text[]) from public, anon, authenticated;
