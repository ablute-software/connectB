-- Prompt 875 — Backoffice Marketing "Overview" tab.
--
-- §1: widen promo_outreach_targets' category check to add 'vc'. Nuno's four
-- outreach categories ("contacto directo, VC, programas patrocinados,
-- Aceleradoras/incubadoras") map onto the existing four DB values
-- (startup/accelerator/incubator/program) with one gap: nothing represents
-- "VC" today. Exact constraint name confirmed against the live schema before
-- writing this (pg_get_constraintdef on promo_outreach_targets), not guessed:
-- promo_outreach_targets_category_check.
alter table promo_outreach_targets drop constraint promo_outreach_targets_category_check;
alter table promo_outreach_targets add constraint promo_outreach_targets_category_check
  check (category in ('startup','accelerator','incubator','program','vc'));

-- §2: two read-only aggregate functions for the new page's heavier
-- computations (per-org AI cost sums, monthly revenue grouping) — real SQL
-- aggregation via the service-role client, not pulling every ai_call_log/
-- billing_invoices row into Node, per the prompt's own instruction that both
-- tables "grow without bound".
--
-- security invoker (not definer), matching CLAUDE.md's documented exception
-- reasoning for matchdeal_startup_hype (a cross-user aggregate whose only
-- readers already bypass RLS by ROLE): the only caller of both functions
-- below is the backoffice route's service-role client, which already
-- bypasses RLS on ai_call_log/orgs/billing_invoices/promo_redemptions via
-- rolbypassrls — invoker semantics cost nothing here and avoid definer's
-- sharper edges for zero benefit. Still revoked from every RLS-respecting
-- role as defense in depth, same posture as every other admin-only function
-- in this schema.
--
-- One redemption WINDOW per org, not per redemption row: ablute_ (the seed
-- org) has FOUR overlapping promo_redemptions rows in production today
-- (07-28 through 08-13, one with no expiry at all) — summing AI cost per
-- REDEMPTION would count the same ai_call_log rows up to four times for one
-- org. The window is collapsed to one span per org (earliest redeemed_at,
-- latest benefit_ends_at — permanent if ANY redemption for that org never
-- expires) before the cost sum runs, matching the prompt's own framing
-- ("for every startup org that redeemed a promo code... summed across all
-- such orgs" — org-level, not redemption-level).
create or replace function public.marketing_overview_promo_net_cost()
returns table (
  org_id uuid, org_name text, redeemed_at timestamptz, benefit_ends_at timestamptz,
  ai_cost_eur numeric, amount_paid_eur numeric, net_eur numeric
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with windows as (
    -- is_test orgs excluded at the source: a future zz-test fixture
    -- redeeming a promo code (to verify this exact function, the same way
    -- zz-test-874-invoice-mirror was built to verify Prompt 874's webhook)
    -- must not show up as a real net-cost row on Nuno's dashboard — see the
    -- same reasoning, caught empirically, on the `paid` CTE below.
    select r.org_id,
      min(r.redeemed_at) as redeemed_at,
      case when bool_or(r.benefit_ends_at is null) then null else max(r.benefit_ends_at) end as benefit_ends_at
    from promo_redemptions r
    join orgs o on o.id = r.org_id and o.is_test = false
    group by r.org_id
  ),
  cost as (
    select w.org_id, coalesce(sum(l.cost_eur), 0) as ai_cost_eur
    from windows w
    left join ai_call_log l
      on l.org_id = w.org_id
      and l.created_at >= w.redeemed_at
      and l.created_at <= coalesce(least(now(), w.benefit_ends_at), now())
    group by w.org_id
  ),
  paid as (
    -- Prompt 874's own table. amount_paid_cents is already what Stripe
    -- reports as paid on the invoice — no distinction here between a
    -- promo-discounted payment and a full-price one, matching "what they
    -- actually paid" verbatim.
    --
    -- Excludes is_test orgs — caught empirically before shipping: this
    -- session's own zz-test-874-invoice-mirror fixture (created to verify
    -- Prompt 874's webhook math) carries a real 'paid' billing_invoices row,
    -- and an unfiltered version of this function reported its €29 as real
    -- revenue in a manual check. billing_invoices itself has no is_test
    -- column (it only exists on orgs/catalog_entities), so the filter has
    -- to join out to orgs.
    select bi.org_id, sum(bi.amount_paid_cents) / 100.0 as amount_paid_eur
    from billing_invoices bi
    join orgs o on o.id = bi.org_id and o.is_test = false
    where bi.kind = 'org'
    group by bi.org_id
  )
  -- net_eur = paid − cost, NOT cost − paid: Nuno's own worked example reads
  -- "(cost while on promo) − (amount actually paid)" in prose but treats
  -- cost as a negative outflow in the underlying arithmetic, so the number
  -- he expects to see is negative when the program net-costs the platform
  -- (the normal early-stage-discount case) — i.e. paid minus cost, not the
  -- other way round. Confirmed against this function's own first real
  -- output before shipping: ablute_'s €8.18 of AI cost and €0 paid produced
  -- +8.18 under a literal cost-minus-paid reading, the wrong sign per the
  -- prompt's own stated expectation; flipped here so it reads -8.18.
  select w.org_id, o.name, w.redeemed_at, w.benefit_ends_at,
    c.ai_cost_eur, coalesce(p.amount_paid_eur, 0) as amount_paid_eur,
    coalesce(p.amount_paid_eur, 0) - c.ai_cost_eur as net_eur
  from windows w
  join orgs o on o.id = w.org_id
  join cost c on c.org_id = w.org_id
  left join paid p on p.org_id = w.org_id
  order by w.redeemed_at;
$fn$;

revoke all on function public.marketing_overview_promo_net_cost() from public, anon, authenticated;
grant execute on function public.marketing_overview_promo_net_cost() to service_role;

-- Monthly revenue + paying-org count for the chart. Scoped to kind='org'
-- (the founder side) only, matching this whole page's scope — the Marketing
-- Overview tab is about the startup-facing promo/outreach funnel, not
-- investor firm billing, which already has its own reporting surface.
-- "Paying users" is defined as distinct orgs with a PAID INVOICE that
-- month — the same fact the revenue bar for that month is built from — not
-- a live orgs.plan snapshot, which would answer a different question
-- ("who is on a paying plan today") and could disagree with the bars in a
-- given historical month (a since-downgraded org's past paid months would
-- vanish from a plan-based count but must not vanish from the revenue it
-- already generated).
create or replace function public.marketing_overview_revenue_by_month()
returns table (month text, revenue_eur numeric, paying_org_count int)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  -- is_test orgs excluded — same empirical catch as marketing_overview_
  -- promo_net_cost's own `paid` CTE: this session's own zz-test-874-
  -- invoice-mirror fixture carries a real 'paid' billing_invoices row, and
  -- an unfiltered version of this function reported its €29 as September
  -- revenue in a manual check before this fix.
  select to_char(date_trunc('month', bi.paid_at), 'YYYY-MM') as month,
    sum(bi.amount_paid_cents) / 100.0 as revenue_eur,
    count(distinct bi.org_id) as paying_org_count
  from billing_invoices bi
  join orgs o on o.id = bi.org_id and o.is_test = false
  where bi.status = 'paid' and bi.kind = 'org' and bi.paid_at is not null
  group by 1
  order by 1;
$fn$;

revoke all on function public.marketing_overview_revenue_by_month() from public, anon, authenticated;
grant execute on function public.marketing_overview_revenue_by_month() to service_role;
