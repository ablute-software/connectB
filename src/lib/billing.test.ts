import { describe, expect, it } from 'vitest';
import {
  priceIdFor, tierForPriceId, planForSubscription, billingEffectFromEvent, invoiceEffectFromEvent,
  parseStripeSigHeader,
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

describe('invoiceEffectFromEvent (Prompt 874 — invoice mirror, founder side)', () => {
  it('invoice.paid extracts amounts, period, paid_at (status_transitions), and sets next_payment_due_at from period_end', () => {
    const event = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1', customer: 'cus_1', subscription: 'sub_1',
          amount_due: 2900, amount_paid: 2900, currency: 'eur', status: 'paid',
          period_start: 1735689600, period_end: 1738368000, due_date: 1738368000,
          status_transitions: { paid_at: 1735689650 },
          hosted_invoice_url: 'https://invoice.stripe.com/i/x', metadata: { org_id: 'o1' },
        },
      },
    };
    expect(invoiceEffectFromEvent(event)).toEqual({
      orgId: 'o1',
      stripeInvoiceId: 'in_1',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      amountDueCents: 2900,
      amountPaidCents: 2900,
      currency: 'eur',
      status: 'paid',
      periodStart: new Date(1735689600 * 1000).toISOString(),
      periodEnd: new Date(1738368000 * 1000).toISOString(),
      dueDate: new Date(1738368000 * 1000).toISOString(),
      paidAt: new Date(1735689650 * 1000).toISOString(),
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/x',
      nextPaymentDueAt: new Date(1738368000 * 1000).toISOString(),
      lastPaymentStatus: 'paid',
    });
  });

  it('invoice.payment_failed marks last_payment_status=failed and leaves next_payment_due_at null', () => {
    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_2', customer: 'cus_1', amount_due: 2900, amount_paid: 0,
          currency: 'eur', status: 'open', metadata: { org_id: 'o1' },
        },
      },
    };
    const effect = invoiceEffectFromEvent(event);
    expect(effect?.lastPaymentStatus).toBe('failed');
    expect(effect?.nextPaymentDueAt).toBeNull();
    expect(effect?.status).toBe('open');
  });

  it('falls back to subscription_details.metadata when top-level metadata is empty', () => {
    const event = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_3', amount_due: 100, amount_paid: 100, status: 'paid',
          metadata: {}, subscription_details: { metadata: { org_id: 'o1' } },
        },
      },
    };
    expect(invoiceEffectFromEvent(event)?.orgId).toBe('o1');
  });

  it('returns a null orgId (not the whole effect) when no metadata names one, for the route to resolve by customer id', () => {
    const event = { type: 'invoice.paid', data: { object: { id: 'in_4', amount_due: 100, amount_paid: 100, status: 'paid' } } };
    expect(invoiceEffectFromEvent(event)?.orgId).toBeNull();
    expect(invoiceEffectFromEvent(event)?.stripeInvoiceId).toBe('in_4');
  });

  it('defers to the investor side when metadata names a firm and no org', () => {
    const event = {
      type: 'invoice.paid',
      data: { object: { id: 'in_5', amount_due: 100, amount_paid: 100, status: 'paid', metadata: { catalog_entity_id: 'f1' } } },
    };
    expect(invoiceEffectFromEvent(event)).toBeNull();
  });

  it('ignores unhandled invoice event types (e.g. invoice.finalized — explicitly out of scope)', () => {
    const event = { type: 'invoice.finalized', data: { object: { id: 'in_6', metadata: { org_id: 'o1' } } } };
    expect(invoiceEffectFromEvent(event)).toBeNull();
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
