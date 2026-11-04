-- Org fiscal/billing details (NIF + address) and the InvoiceXpress mirror
-- columns on billing_invoices (Prompt: Sherlock Deal Stripe -> InvoiceXpress
-- integration, decided by Nuno 2026-11-04):
--   1. At checkout time the app offers to prefill these from the org and
--      lets the founder edit them.
--   2. A missing fiscal_id is allowed -- the founder can proceed without one,
--      warned that the invoice will then be issued without a NIF.
--   3. The webhook uses these columns (as they stood when invoice.paid
--      fired) to build the InvoiceXpress client, and stamps the created
--      document's id/permalink back onto the billing_invoices row so a
--      replayed Stripe event never creates a duplicate.
alter table orgs
  add column if not exists fiscal_id text,
  add column if not exists billing_address text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_city text,
  add column if not exists billing_country text default 'PT';

comment on column orgs.fiscal_id is 'NIF/NIPC used on InvoiceXpress invoices. Optional -- may be issued as "Consumidor Final" when absent.';

alter table billing_invoices
  add column if not exists invoicexpress_document_id text,
  add column if not exists invoicexpress_permalink text,
  add column if not exists invoicexpress_error text;

comment on column billing_invoices.invoicexpress_document_id is 'InvoiceXpress document id (invoice_receipt or credit_note) created for this Stripe invoice/refund. Null = not yet created (or InvoiceXpress not configured).';
comment on column billing_invoices.invoicexpress_error is 'Last error message from the InvoiceXpress call, if it failed -- kept for support/back-office visibility, never retried blindly by a Stripe replay alone.';
