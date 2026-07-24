// Billing — pure, I/O-free core for Stripe subscriptions. Unit-tested; the
// checkout/portal/webhook routes compose these. No SDK, no env reads here (the
// env half lives in stripe-env.ts) — everything below is deterministic given
// its inputs, so price-ID resolution, the webhook event→plan mapping, and the
// downgrade semantics are all testable without a live Stripe or a signature.
import type { PlanTier } from './types';
import type { BillingPeriod } from './plans';
import { normalizePlan } from './plans';

// The four price IDs (paid tiers × two periods). The free 'idea' tier has no
// price — it's what a canceled/absent subscription resolves to.
export interface StripePriceMap {
  garage: { monthly?: string; annual?: string };
  motherfunding: { monthly?: string; annual?: string };
}

// Copy hygiene (founder rule): the UI says "secure payment" — never the
// provider's name.
export const SECURE_PAYMENT_COPY = 'Secure payment';

// A subscription is treated as paying while in any of these states — including
// past_due (dunning grace) and a subscription set to cancel_at_period_end
// (which stays 'active' until the period actually ends, then fires
// customer.subscription.deleted). Downgrade happens on the DELETE event, not on
// the cancel request — that's the "stays until period end" semantics.
export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function priceIdFor(tier: PlanTier, period: BillingPeriod, prices: StripePriceMap): string | undefined {
  if (tier === 'garage' || tier === 'motherfunding') return prices[tier]?.[period];
  return undefined; // 'idea' is free — no checkout
}

// Reverse lookup: which (tier, period) does a Stripe price ID belong to?
export function tierForPriceId(priceId: string, prices: StripePriceMap): { tier: PlanTier; period: BillingPeriod } | undefined {
  for (const tier of ['garage', 'motherfunding'] as const) {
    for (const period of ['monthly', 'annual'] as const) {
      if (prices[tier]?.[period] && prices[tier][period] === priceId) return { tier, period };
    }
  }
  return undefined;
}

// Map a subscription's (status, current price) to the org's plan. A non-paying
// status, or a price we don't recognise, resolves to the free 'idea' tier.
export function planForSubscription(
  status: string,
  priceId: string | undefined,
  prices: StripePriceMap,
): { plan: PlanTier; period: BillingPeriod | null } {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return { plan: 'idea', period: null };
  const match = priceId ? tierForPriceId(priceId, prices) : undefined;
  return match ? { plan: match.tier, period: match.period } : { plan: 'idea', period: null };
}

// What a webhook event should change in our DB. Returns null for events we
// don't act on. org_id travels in metadata (set at checkout on both the session
// and the subscription), so every handled event carries it.
export interface BillingEffect {
  orgId: string;
  plan: PlanTier;
  period: BillingPeriod | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null; // null clears it (on cancel/delete)
}

interface StripeEventLike {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

export function billingEffectFromEvent(event: StripeEventLike, prices: StripePriceMap): BillingEffect | null {
  const type = event.type;
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const orgId = meta.org_id;
  if (!orgId) return null;

  if (type === 'checkout.session.completed') {
    // The plan comes straight from the metadata we set at checkout, so no
    // extra subscription fetch is needed to activate the plan.
    if (!meta.tier) return null;
    return {
      orgId,
      plan: normalizePlan(meta.tier),
      period: meta.period === 'annual' ? 'annual' : 'monthly',
      stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
    };
  }

  if (type === 'customer.subscription.updated') {
    const status = String(obj.status ?? '');
    const items = obj.items as { data?: { price?: { id?: string } }[] } | undefined;
    const priceId = items?.data?.[0]?.price?.id;
    const { plan, period } = planForSubscription(status, priceId, prices);
    return {
      orgId,
      plan,
      period,
      stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      // Keep the subscription id while paying; clear it once it resolves to free.
      stripeSubscriptionId: plan === 'idea' ? null : (typeof obj.id === 'string' ? obj.id : undefined),
    };
  }

  if (type === 'customer.subscription.deleted') {
    return { orgId, plan: 'idea', period: null, stripeSubscriptionId: null };
  }

  return null;
}

// Parse a Stripe-Signature header ("t=<ts>,v1=<sig>,v1=<sig>…") into its
// timestamp and the v1 signatures. Pure so the parsing is testable; the HMAC
// compare + timestamp tolerance live in the route (they need crypto + clock).
export function parseStripeSigHeader(header: string): { timestamp: string | null; v1: string[] } {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: string | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1.push(v);
  }
  return { timestamp, v1 };
}
