-- Prompt 588 Bloco C — backs the /investors pricing copy ("your first month
-- is on us while the startup base grows"): that line needs a real date to
-- be true, not just a claim. investor_billing (migration 0288) is already
-- the firm-level billing-state table (access_state, plan_tier, ...); this
-- adds the one new column the copy depends on.
--
-- PROPOSED, NOT APPLIED to production by this session — this branch's own
-- report shows it applied against a Supabase preview branch for
-- verification only; a human (or the revisor session) applies it for real,
-- same convention as every other migration in this repo (see e.g. 0145's
-- own header comment).
--
-- Naming: the last several migrations in this repo switched from the old
-- NNNN_description.sql sequence (last: 0343) to a plain UTC timestamp
-- prefix (see e.g. 20260914160000_promo_codes_cancellation.sql) — this
-- follows that newer convention rather than inventing a new 4-digit number
-- that could collide with another branch's own next-in-sequence pick.

alter table public.investor_billing
  add column if not exists investor_access_started_at timestamptz;

comment on column public.investor_billing.investor_access_started_at is
  'Prompt 588 — set once, on the first real read of this firm''s own investor profile (ensureInvestorAccessStarted, src/lib/investor-access-period.ts). NULL means the firm has never loaded its profile yet (predates this column, or has not signed in since). Never backdated after this migration''s own one-time backfill below.';

-- Backfill (§Bloco C.2): existing investor accounts get TODAY's date, not a
-- retroactive one — "the month starts counting from when this copy ships,
-- not from whenever they first signed in". Scoped to firms that actually
-- have at least one active seat today (matchdeal_investor_members) AND are
-- not catalog_entities.is_test — checked empirically before writing this
-- (Prompt 588): of the 5 firms with an active seat in production today, 4
-- are is_test=true ("Test investor", "Test idividual", the individual
-- fixture at nunomarujo@gmail.com, and "ablute_ — Internal QA"); only
-- "Invest green" is a real account. Without this filter the backfill (and
-- every later attention-queue read of this column) would treat internal
-- fixtures as real early-access customers — exactly the is_test-vs-real
-- gap this codebase has been burned by before (see the is_test filtering
-- already applied throughout investor-pipeline.ts and backoffice-metrics.ts
-- for the same reason). One row per firm: insert if investor_billing has
-- none yet, update in place if it already does (a firm can already have a
-- row via Stripe/access_state without ever having had this column set).
insert into public.investor_billing (catalog_entity_id, investor_access_started_at)
select distinct m.catalog_entity_id, now()
from public.matchdeal_investor_members m
join public.catalog_entities c on c.id = m.catalog_entity_id
where m.status = 'active'
  and c.is_test is not true
  and not exists (
    select 1 from public.investor_billing b where b.catalog_entity_id = m.catalog_entity_id
  )
on conflict (catalog_entity_id) do nothing;

update public.investor_billing b
set investor_access_started_at = now()
where investor_access_started_at is null
  and exists (
    select 1 from public.matchdeal_investor_members m
    join public.catalog_entities c on c.id = m.catalog_entity_id
    where m.catalog_entity_id = b.catalog_entity_id and m.status = 'active' and c.is_test is not true
  );
