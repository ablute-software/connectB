-- Plans & Account batch. The founder's spec assumed orgs.plan was free text,
-- but 0001 defined it as the enum plan_tier ('free','paid'). To store the three
-- new founder tiers ('idea','garage','motherfunding') we move the column to
-- text, remap legacy rows, and add the plan-change request queue.
--
-- Safe to apply anytime: the app maps legacy values in code (normalizePlan) and
-- gates every write path on a probe of plan_change_requested, so nothing here
-- is load-bearing until it lands. Additive + reversible in spirit (the enum
-- type is left in place, just unused).

-- 1) Move plan off the two-value enum to free text.
alter table orgs alter column plan drop default;
alter table orgs alter column plan type text using plan::text;

-- 2) Remap the legacy two-tier values to the new tiers.
update orgs set plan = 'idea'   where plan = 'free';
update orgs set plan = 'garage' where plan = 'paid';

-- 3) New default for brand-new orgs is the free 'idea' tier.
alter table orgs alter column plan set default 'idea';

-- 4) ablute_'s own org gets full access (top tier). Id per CLAUDE.md seed.
update orgs set plan = 'motherfunding' where id = 'bca54499-03c8-469b-a48d-b9f442e44f69';

-- 5) Plan-change request queue: the founder's upgrade CTA writes the requested
--    tier + timestamp; a platform admin clears both when they flip the plan.
alter table orgs add column if not exists plan_change_requested text;
alter table orgs add column if not exists plan_change_requested_at timestamptz;

-- Note: the now-unused enum type plan_tier is intentionally kept (dropping it
-- is a separate, riskier change and buys nothing here).
