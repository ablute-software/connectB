-- Prompt 114 §3.1 — device exclusivity as a database invariant, not just
-- application logic. Verified zero duplicate active (org_id, kind) rows
-- exist before this ships (checked live), so no cleanup UPDATE was needed —
-- Fase 2's own disconnect-the-others step (consumePairingToken) keeps it
-- that way going forward.
create unique index matchdeal_pairings_one_active_per_org
  on matchdeal_pairings (org_id, kind) where status = 'active';
