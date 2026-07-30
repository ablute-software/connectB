-- Fix: matchdeal_pairings.org_id for kind='investor' is catalog_entities.id
-- (the stable investor-firm identity, same convention admin_org_actions
-- already uses — migration "metrics_v1_backoffice_fixes") — NOT
-- matchdeal_investor_members.id (matchdeal_current_membership_ids()
-- returns the latter, so the original policy silently never matched any
-- real investor pairing row). Caught before any real row existed.
drop policy if exists matchdeal_pairings_own_org on matchdeal_pairings;
create policy matchdeal_pairings_own_org on matchdeal_pairings for select
  using (
    (kind = 'startup' and org_id in (select org_id from org_members where user_id = auth.uid()))
    or (kind = 'investor' and org_id in (
      select catalog_entity_id from matchdeal_investor_members where user_id = auth.uid() and status = 'active'
    ))
  );
