-- Prompt 874 — infrastructure prerequisite for 875/876/877: a local mirror
-- of Stripe invoices, both sides of this schema's billing split (orgs the
-- founder side, investor_billing the firm side), keyed by an explicit
-- discriminator — same pattern ViewerEntryName.tsx already uses for a
-- two-schema "customer" concept (kind: 'org' | 'investor_entity').
--
-- Confirmed by reading the whole webhook + billing.ts before writing this:
-- no invoice.* event is ever received today, and neither orgs nor
-- investor_billing has ever recorded a payment amount or a due date. This
-- table is the missing ledger 875's net-cost number and 877's overdue
-- highlighting both need real facts for, instead of estimates.
create table billing_invoices (
  id                   uuid primary key default uuid_generate_v4(),
  kind                 text not null check (kind in ('org', 'investor_entity')),
  -- exactly one of these two is set, matching `kind`.
  org_id               uuid references orgs(id) on delete cascade,
  catalog_entity_id    uuid references catalog_entities(id) on delete cascade,
  stripe_invoice_id    text not null unique,
  stripe_customer_id   text,
  stripe_subscription_id text,
  amount_due_cents     int not null,
  amount_paid_cents    int not null,
  currency             text not null default 'eur',
  status               text not null check (status in ('draft','open','paid','uncollectible','void')),
  period_start         timestamptz,
  period_end           timestamptz,
  due_date             timestamptz,
  paid_at              timestamptz,
  hosted_invoice_url   text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint billing_invoices_kind_subject check (
    (kind = 'org' and org_id is not null and catalog_entity_id is null) or
    (kind = 'investor_entity' and catalog_entity_id is not null and org_id is null)
  )
);
alter table billing_invoices enable row level security;
-- Same posture as investor_billing (0287's own reasoning applies word for
-- word here): no policies, revoke anon/authenticated entirely — invoice
-- amounts are exactly the kind of Stripe-adjacent data that table's own
-- comment already measured as unsafe to expose via PostgREST. Only
-- service-role routes (the webhook, and the new backoffice reads for
-- 875/876/877) touch this table.
revoke all on table billing_invoices from anon, authenticated;
create index on billing_invoices (org_id) where org_id is not null;
create index on billing_invoices (catalog_entity_id) where catalog_entity_id is not null;
create index on billing_invoices (status, due_date);

-- Two cheap denormalized columns so 877's list view doesn't need a
-- correlated subquery per row on every page load. Kept in sync by the
-- webhook handler itself (which already has the values it just wrote), not
-- a trigger — a trigger would just re-derive the same thing from the row
-- it's reacting to.
alter table orgs add column if not exists next_payment_due_at timestamptz;
alter table orgs add column if not exists last_payment_status text
  check (last_payment_status is null or last_payment_status in ('paid','failed','none'));
alter table investor_billing add column if not exists next_payment_due_at timestamptz;
alter table investor_billing add column if not exists last_payment_status text
  check (last_payment_status is null or last_payment_status in ('paid','failed','none'));

-- Reverse-lookup indexes for the invoice webhook's org/firm resolution
-- fallback (metadata.org_id / metadata.catalog_entity_id absent — Stripe
-- invoices do not reliably inherit subscription metadata). Confirmed by
-- reading billing.ts/route.ts before writing this migration: NEITHER
-- existing subscription-event handler actually implements such a
-- fallback today, despite investor_billing's own 0287 migration already
-- carrying a comment ("Índice para a resolução inversa do webhook") and an
-- index on stripe_subscription_id that anticipated one. This is genuinely
-- new code (§2 below), not a reuse of an existing path — see this
-- prompt's own reply for the flagged discrepancy from what the prompt
-- assumed. orgs never had an equivalent index at all; added here since the
-- founder-side fallback needs the same lookup shape investor_billing's
-- subscription index already anticipated for the investor side.
create index on orgs (stripe_customer_id) where stripe_customer_id is not null;
create index on investor_billing (stripe_customer_id) where stripe_customer_id is not null;
