-- Billing — Stripe subscriptions. orgs already carries stripe_customer_id (from
-- 0001); this adds the subscription id and the chosen billing period so the
-- app can show "Gerir subscrição" and the current cadence. Written ONLY by the
-- Stripe webhook (the source of truth for billing-driven plan changes); the
-- manual back-office set-plan stays as an override for comps/support.
--
-- Additive + nullable. Apply this BEFORE setting the Stripe env vars — billing
-- is gated on env (stripeConfigured), and the webhook writes these columns.
alter table orgs add column if not exists stripe_subscription_id text;
alter table orgs add column if not exists stripe_billing_period text; -- 'monthly' | 'annual'
