-- Prompt 585 §E — the entity-header "who to contact and why" block needs a
-- reachability fallback signal beyond LinkedIn: matchdeal_profiles.accepts_cold_contact,
-- per Nuno's "reuse only what's real" decision. But a founder cannot read
-- this directly: matchdeal_investor_members_select_own restricts that table
-- to `user_id = auth.uid()` (the investor's own account only), which blocks
-- the join from catalog_entity_id -> membership_id -> matchdeal_profiles
-- that matchdeal_investor_firm_view already performs (and that function is
-- itself revoked from authenticated — service_role only, by design, since it
-- projects far more than a founder should see: description, tickets,
-- exclusions, representative contact details).
--
-- This is a narrower, purpose-built sibling: projects ONLY
-- accepts_cold_contact + preferred_contact_channel (both already shown to a
-- founder indirectly today via MatchDealDeck's own CardFace for any visible
-- investor), and only for a catalog entity already in the calling org's own
-- pipeline (catalog_deliveries), never for an arbitrary catalog_id.
create or replace function public.catalog_entity_contact_context(p_org_id uuid, p_catalog_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_accepts boolean;
  v_channel text;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from catalog_deliveries where org_id = p_org_id and catalog_id = p_catalog_id) then
    return null;
  end if;

  select pr.accepts_cold_contact, pr.preferred_contact_channel
    into v_accepts, v_channel
  from matchdeal_profiles pr
  join matchdeal_investor_members mem on mem.id = pr.membership_id
  where pr.kind = 'investor' and mem.catalog_entity_id = p_catalog_id and mem.status = 'active'
    and pr.owner_suspended_at is null and pr.platform_suspended_at is null
  order by (pr.accepts_cold_contact is not null) desc, pr.updated_at desc nulls last
  limit 1;

  if v_accepts is null and v_channel is null then return null; end if;
  return jsonb_build_object('accepts_cold_contact', v_accepts, 'preferred_contact_channel', v_channel);
end;
$$;

revoke all on function public.catalog_entity_contact_context(uuid, uuid) from public, anon;
grant execute on function public.catalog_entity_contact_context(uuid, uuid) to authenticated, service_role;
