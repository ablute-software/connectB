-- The investor side of the InvoiceXpress fiscal details (the founder side is
-- 20261104120000, on orgs): the firm's NIF and billing address, offered for
-- editing before checkout and read by the Stripe webhook when invoice.paid fires.
--
-- On investor_billing and NOT on catalog_entities, for the reason 0287 already
-- measured for stripe_customer_id: catalog_entities is a public catalogue. Its
-- policy `catalog_read` lets anyone, `anon` included, read every verified row,
-- and a new column inherits the table-wide SELECT grant, so a NIF and a billing
-- address there would be readable by the whole internet through PostgREST.
-- investor_billing has one row per firm, RLS on, no policies, and is revoked
-- from anon/authenticated: only service-role routes reach these columns.
--
-- billing_invoices needs nothing new: the invoicexpress_* columns of
-- 20261104120000 already serve both kinds of row.
alter table investor_billing
  add column if not exists fiscal_id text,
  add column if not exists billing_address text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_city text,
  add column if not exists billing_country text default 'PT';

comment on column investor_billing.fiscal_id is 'NIF/NIPC used on InvoiceXpress invoices for this firm. Optional, as on orgs.fiscal_id.';
