// Billing — the env half (server-only). Mirrors the resend/google-oauth
// env-gate pattern: everything billing-related is dark until ALL of these are
// set, at which point the Plans page CTA becomes real checkout. Raw fetch, no
// SDK. The pure logic lives in billing.ts.
import 'server-only';
import type { InvestorStripePriceMap, StripePriceMap } from './billing';

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

// --- Investor billing (Prompt 501) ---------------------------------------
// DOIS gates independentes, não um só. A razão é operacional e decidiu-se
// sozinha ao olhar para o estado real: o billing do founder está VIVO em
// produção. Um gate único exigiria os 6 price IDs de investidor para
// `stripeConfigured()` continuar verdadeiro — ou seja, no instante em que
// este código fosse para produção sem esses IDs existirem ainda no Stripe, o
// checkout do founder apagava-se. Um lado não pode ter poder de desligar o
// outro. Assim, cada lado acende quando o SEU conjunto de env vars estiver
// completo, e o founder não muda de comportamento com este prompt.
//
// Dentro de cada gate mantém-se o tudo-ou-nada do original: meio configurado
// cria checkouts partidos.
export function investorBillingConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY
    && process.env.STRIPE_WEBHOOK_SECRET
    && process.env.STRIPE_PRICE_PRO_SCOUT_MONTHLY
    && process.env.STRIPE_PRICE_PRO_SCOUT_ANNUAL
    && process.env.STRIPE_PRICE_ACE_SPOTTER_MONTHLY
    && process.env.STRIPE_PRICE_ACE_SPOTTER_ANNUAL
    && process.env.STRIPE_PRICE_LEGENDARY_SLEUTH_MONTHLY
    && process.env.STRIPE_PRICE_LEGENDARY_SLEUTH_ANNUAL
  );
}

export function investorStripePriceMap(): InvestorStripePriceMap {
  return {
    pro_scout: {
      monthly: process.env.STRIPE_PRICE_PRO_SCOUT_MONTHLY,
      annual: process.env.STRIPE_PRICE_PRO_SCOUT_ANNUAL,
    },
    ace_spotter: {
      monthly: process.env.STRIPE_PRICE_ACE_SPOTTER_MONTHLY,
      annual: process.env.STRIPE_PRICE_ACE_SPOTTER_ANNUAL,
    },
    legendary_sleuth: {
      monthly: process.env.STRIPE_PRICE_LEGENDARY_SLEUTH_MONTHLY,
      annual: process.env.STRIPE_PRICE_LEGENDARY_SLEUTH_ANNUAL,
    },
  };
}
