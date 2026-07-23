// Billing — the env half (server-only). Mirrors the resend/google-oauth
// env-gate pattern: everything billing-related is dark until ALL of these are
// set, at which point the Plans page CTA becomes real checkout. Raw fetch, no
// SDK. The pure logic lives in billing.ts.
import 'server-only';
import type { StripePriceMap } from './billing';

// Billing is only "configured" when the secret, the webhook secret, AND all
// four price IDs are present — a half-configured Stripe would create broken
// checkouts, so it's all-or-nothing.
export function stripeConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY
    && process.env.STRIPE_WEBHOOK_SECRET
    && process.env.STRIPE_PRICE_GARAGE_MONTHLY
    && process.env.STRIPE_PRICE_GARAGE_ANNUAL
    && process.env.STRIPE_PRICE_MOTHERFUNDING_MONTHLY
    && process.env.STRIPE_PRICE_MOTHERFUNDING_ANNUAL
  );
}

export function stripePriceMap(): StripePriceMap {
  return {
    garage: {
      monthly: process.env.STRIPE_PRICE_GARAGE_MONTHLY,
      annual: process.env.STRIPE_PRICE_GARAGE_ANNUAL,
    },
    motherfunding: {
      monthly: process.env.STRIPE_PRICE_MOTHERFUNDING_MONTHLY,
      annual: process.env.STRIPE_PRICE_MOTHERFUNDING_ANNUAL,
    },
  };
}

export const stripeSecret = () => process.env.STRIPE_SECRET_KEY;
export const stripeWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET;
