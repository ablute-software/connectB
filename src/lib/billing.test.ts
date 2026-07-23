import { describe, expect, it } from 'vitest';
import {
  priceIdFor, tierForPriceId, planForSubscription, billingEffectFromEvent, parseStripeSigHeader,
  type StripePriceMap,
} from './billing';

const PRICES: StripePriceMap = {
  garage: { monthly: 'price_gm', annual: 'price_ga' },
  motherfunding: { monthly: 'price_mm', annual: 'price_ma' },
};

describe('priceIdFor (tier + period resolution)', () => {
  it('resolves each paid tier/period to its price id', () => {
    expect(priceIdFor('garage', 'monthly', PRICES)).toBe('price_gm');
    expect(priceIdFor('garage', 'annual', PRICES)).toBe('price_ga');
    expect(priceIdFor('motherfunding', 'monthly', PRICES)).toBe('price_mm');
    expect(priceIdFor('motherfunding', 'annual', PRICES)).toBe('price_ma');
  });

  it('has no price for the free idea tier', () => {
    expect(priceIdFor('idea', 'monthly', PRICES)).toBeUndefined();
    expect(priceIdFor('idea', 'annual', PRICES)).toBeUndefined();
  });

  it('is undefined when a price id is not configured', () => {
    expect(priceIdFor('garage', 'monthly', { garage: {}, motherfunding: {} })).toBeUndefined();
  });
});

describe('tierForPriceId (reverse lookup)', () => {
  it('maps a known price id back to tier + period', () => {
    expect(tierForPriceId('price_ma', PRICES)).toEqual({ tier: 'motherfunding', period: 'annual' });
    expect(tierForPriceId('price_gm', PRICES)).toEqual({ tier: 'garage', period: 'monthly' });
  });

  it('returns undefined for an unknown price id', () => {
    expect(tierForPriceId('price_unknown', PRICES)).toBeUndefined();
  });
});

describe('planForSubscription (status + price → plan)', () => {
  it('active subscription resolves to its tier/period', () => {
    expect(planForSubscription('active', 'price_ga', PRICES)).toEqual({ plan: 'garage', period: 'annual' });
  });

  it('trialing and past_due still count as paying', () => {
    expect(planForSubscription('trialing', 'price_mm', PRICES).plan).toBe('motherfunding');
    expect(planForSubscription('past_due', 'price_mm', PRICES).plan).toBe('motherfunding');
  });

  it('canceled/unpaid resolves to free idea', () => {
    expect(planForSubscription('canceled', 'price_ga', PRICES)).toEqual({ plan: 'idea', period: null });
    expect(planForSubscription('unpaid', 'price_ga', PRICES)).toEqual({ plan: 'idea', period: null });
  });

  it('unknown price on an active sub falls back to idea', () => {
    expect(planForSubscription('active', 'price_unknown', PRICES)).toEqual({ plan: 'idea', period: null });
  });
});

describe('billingEffectFromEvent (webhook mapping — signatures out of scope here)', () => {
  it('checkout.session.completed activates the plan straight from metadata', () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { metadata: { org_id: 'o1', tier: 'garage', period: 'annual' }, customer: 'cus_1', subscription: 'sub_1' } },
    };
    expect(billingEffectFromEvent(event, PRICES)).toEqual({
      orgId: 'o1', plan: 'garage', period: 'annual', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    });
  });

  it('subscription.updated maps the current price to a plan', () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { org_id: 'o1' }, items: { data: [{ price: { id: 'price_mm' } }] } } },
    };
    expect(billingEffectFromEvent(event, PRICES)).toEqual({
      orgId: 'o1', plan: 'motherfunding', period: 'monthly', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    });
  });

  it('cancel_at_period_end does NOT downgrade while status is still active (stays until period end)', () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: true, metadata: { org_id: 'o1' }, items: { data: [{ price: { id: 'price_ga' } }] } } },
    };
    expect(billingEffectFromEvent(event, PRICES)?.plan).toBe('garage');
  });

  it('subscription.deleted downgrades to idea and clears the subscription id', () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled', metadata: { org_id: 'o1' } } },
    };
    expect(billingEffectFromEvent(event, PRICES)).toEqual({ orgId: 'o1', plan: 'idea', period: null, stripeSubscriptionId: null });
  });

  it('ignores events without an org_id in metadata, and unhandled types', () => {
    expect(billingEffectFromEvent({ type: 'checkout.session.completed', data: { object: { metadata: {} } } }, PRICES)).toBeNull();
    expect(billingEffectFromEvent({ type: 'invoice.paid', data: { object: { metadata: { org_id: 'o1' } } } }, PRICES)).toBeNull();
  });
});

describe('parseStripeSigHeader', () => {
  it('extracts the timestamp and all v1 signatures', () => {
    expect(parseStripeSigHeader('t=1700000000,v1=abc,v1=def')).toEqual({ timestamp: '1700000000', v1: ['abc', 'def'] });
  });

  it('tolerates other scheme keys (e.g. v0) and whitespace', () => {
    expect(parseStripeSigHeader('t=123, v1=sig, v0=other')).toEqual({ timestamp: '123', v1: ['sig'] });
  });
});
