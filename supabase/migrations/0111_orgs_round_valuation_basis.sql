-- Prompt 115 Block E — pre/post-money valuation. PROPOSE ONLY, DO NOT APPLY
-- without Nuno's explicit go-ahead — every consumer in the app already
-- falls back to 'pre_money' when this column is absent (via the
-- roundValuationBasisAvailable capability probe), so the UI works correctly
-- whether or not this migration has landed.
--
-- orgs.round_valuation_eur (migration 0037) has never had a documented
-- pre/post-money convention — dilution.ts's own top comment flagged this as
-- a silent per-reader guess (investor-workspace's OwnershipCalculator
-- defaults its own toggle to 'post_money' with no way to know if that's
-- right). This column makes the founder's stated basis an explicit, stored
-- fact instead.
alter table orgs add column round_valuation_basis text not null default 'pre_money'
  check (round_valuation_basis in ('pre_money', 'post_money'));

-- ablute_'s real valuation is confirmed post-money by Nuno.
update orgs set round_valuation_basis = 'post_money' where name = 'ablute_';
