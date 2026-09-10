import { describe, expect, it } from 'vitest';
import {
  investorPriceIdFor, investorTierForPriceId, investorPlanForSubscription,
  investorBillingEffectFromEvent, billingEffectFromEvent,
  investorInvoiceEffectFromEvent, invoiceEffectFromEvent,
  type InvestorStripePriceMap, type StripePriceMap,
} from './billing';
import { INVESTOR_PLANS, INVESTOR_PLAN_TO_MATCHDEAL_TIER, MATCHDEAL_TIER_TO_INVESTOR_PLAN } from './plans';

const PRICES: InvestorStripePriceMap = {
  pro_scout: { monthly: 'price_ps_m', annual: 'price_ps_a' },
  ace_spotter: { monthly: 'price_as_m', annual: 'price_as_a' },
  legendary_sleuth: { monthly: 'price_ls_m', annual: 'price_ls_a' },
};

describe('investorPriceIdFor', () => {
  it('resolves every tier/period pair', () => {
    expect(investorPriceIdFor('pro_scout', 'monthly', PRICES)).toBe('price_ps_m');
    expect(investorPriceIdFor('pro_scout', 'annual', PRICES)).toBe('price_ps_a');
    expect(investorPriceIdFor('ace_spotter', 'monthly', PRICES)).toBe('price_as_m');
    expect(investorPriceIdFor('ace_spotter', 'annual', PRICES)).toBe('price_as_a');
    expect(investorPriceIdFor('legendary_sleuth', 'monthly', PRICES)).toBe('price_ls_m');
    expect(investorPriceIdFor('legendary_sleuth', 'annual', PRICES)).toBe('price_ls_a');
  });

  it('is undefined when that price id is not configured', () => {
    expect(investorPriceIdFor('pro_scout', 'monthly', { pro_scout: {}, ace_spotter: {}, legendary_sleuth: {} }))
      .toBeUndefined();
  });
});

describe('investorTierForPriceId (reverse lookup)', () => {
  it('round-trips every configured price id', () => {
    for (const p of INVESTOR_PLANS) {
      for (const period of ['monthly', 'annual'] as const) {
        const id = investorPriceIdFor(p.tier, period, PRICES)!;
        expect(investorTierForPriceId(id, PRICES)).toEqual({ tier: p.tier, period });
      }
    }
  });

  it('is undefined for an unknown price id', () => {
    expect(investorTierForPriceId('price_nope', PRICES)).toBeUndefined();
  });

  it('never matches a founder price id', () => {
    expect(investorTierForPriceId('price_gm', PRICES)).toBeUndefined();
  });
});

describe('investorPlanForSubscription — não há tier gratuito para onde cair', () => {
  it('resolves a paying subscription to its tier and period', () => {
    expect(investorPlanForSubscription('active', 'price_as_a', PRICES)).toEqual({ tier: 'ace_spotter', period: 'annual' });
  });

  it('treats past_due as still paying (dunning grace), like the founder side', () => {
    expect(investorPlanForSubscription('past_due', 'price_ps_m', PRICES)).toEqual({ tier: 'pro_scout', period: 'monthly' });
  });

  it('resolves a non-paying status to null — NOT to the cheapest paid tier', () => {
    expect(investorPlanForSubscription('canceled', 'price_ls_m', PRICES)).toEqual({ tier: null, period: null });
    expect(investorPlanForSubscription('incomplete_expired', 'price_ps_m', PRICES)).toEqual({ tier: null, period: null });
  });

  it('resolves an unrecognised price to null even while active', () => {
    expect(investorPlanForSubscription('active', 'price_unknown', PRICES)).toEqual({ tier: null, period: null });
  });
});

describe('investorBillingEffectFromEvent', () => {
  it('activates the plan straight from checkout metadata', () => {
    const effect = investorBillingEffectFromEvent({
      type: 'checkout.session.completed',
      data: { object: { metadata: { catalog_entity_id: 'firm-1', tier: 'ace_spotter', period: 'annual' }, customer: 'cus_1', subscription: 'sub_1' } },
    }, PRICES);
    expect(effect).toEqual({
      catalogEntityId: 'firm-1', tier: 'ace_spotter', period: 'annual',
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    });
  });

  it('ignores a checkout whose metadata tier is not a real investor tier', () => {
    expect(investorBillingEffectFromEvent({
      type: 'checkout.session.completed',
      data: { object: { metadata: { catalog_entity_id: 'firm-1', tier: 'garage' } } },
    }, PRICES)).toBeNull();
  });

  it('follows a tier switch made in the portal', () => {
    const effect = investorBillingEffectFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_ls_m' } }] } } },
    }, PRICES);
    expect(effect).toMatchObject({ catalogEntityId: 'firm-1', tier: 'legendary_sleuth', period: 'monthly', stripeSubscriptionId: 'sub_1' });
  });

  it('clears the subscription id once an update resolves to no paid plan', () => {
    const effect = investorBillingEffectFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'canceled', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_ps_m' } }] } } },
    }, PRICES);
    expect(effect).toMatchObject({ tier: null, period: null, stripeSubscriptionId: null });
  });

  it('downgrades only on the delete event — a cancel request keeps the plan until then', () => {
    // Um pedido de cancelamento deixa a subscrição 'active' (cancel_at_period_end)
    expect(investorBillingEffectFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_as_m' } }] } } },
    }, PRICES)).toMatchObject({ tier: 'ace_spotter' });
    expect(investorBillingEffectFromEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', metadata: { catalog_entity_id: 'firm-1' } } },
    }, PRICES)).toEqual({ catalogEntityId: 'firm-1', tier: null, period: null, stripeSubscriptionId: null });
  });

  it('ignores an event with no catalog_entity_id', () => {
    expect(investorBillingEffectFromEvent({
      type: 'checkout.session.completed', data: { object: { metadata: { tier: 'pro_scout' } } },
    }, PRICES)).toBeNull();
  });

  it('ignores event types it does not act on', () => {
    expect(investorBillingEffectFromEvent({
      type: 'invoice.paid', data: { object: { metadata: { catalog_entity_id: 'firm-1' } } },
    }, PRICES)).toBeNull();
  });
});

// O que garante que UM endpoint de webhook pode servir os dois lados sem os
// confundir: cada função ignora os eventos do outro domínio.
describe('founder and investor events never cross over on the shared webhook', () => {
  const FOUNDER_PRICES: StripePriceMap = { garage: { monthly: 'price_gm' }, motherfunding: {} };

  it('the investor mapper ignores a founder event', () => {
    const founderEvent = {
      type: 'checkout.session.completed',
      data: { object: { metadata: { org_id: 'org-1', tier: 'garage', period: 'monthly' } } },
    };
    expect(investorBillingEffectFromEvent(founderEvent, PRICES)).toBeNull();
    expect(billingEffectFromEvent(founderEvent, FOUNDER_PRICES)).toMatchObject({ orgId: 'org-1', plan: 'garage' });
  });

  it('the founder mapper ignores an investor event', () => {
    const investorEvent = {
      type: 'checkout.session.completed',
      data: { object: { metadata: { catalog_entity_id: 'firm-1', tier: 'pro_scout', period: 'monthly' } } },
    };
    expect(billingEffectFromEvent(investorEvent, FOUNDER_PRICES)).toBeNull();
    expect(investorBillingEffectFromEvent(investorEvent, PRICES)).toMatchObject({ catalogEntityId: 'firm-1', tier: 'pro_scout' });
  });
});

describe('investorInvoiceEffectFromEvent (Prompt 874 — invoice mirror, investor side)', () => {
  it('invoice.paid extracts the firm invoice and sets next_payment_due_at from period_end', () => {
    const event = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_f1', customer: 'cus_firm_1', subscription: 'sub_firm_1',
          amount_due: 13000, amount_paid: 13000, currency: 'eur', status: 'paid',
          period_end: 1738368000, status_transitions: { paid_at: 1735689650 },
          metadata: { catalog_entity_id: 'firm-1' },
        },
      },
    };
    const effect = investorInvoiceEffectFromEvent(event);
    expect(effect).toMatchObject({
      catalogEntityId: 'firm-1', stripeInvoiceId: 'in_f1', amountPaidCents: 13000,
      status: 'paid', lastPaymentStatus: 'paid',
      nextPaymentDueAt: new Date(1738368000 * 1000).toISOString(),
    });
  });

  it('invoice.payment_failed marks failed and leaves next_payment_due_at null', () => {
    const event = {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_f2', amount_due: 13000, amount_paid: 0, status: 'open', metadata: { catalog_entity_id: 'firm-1' } } },
    };
    const effect = investorInvoiceEffectFromEvent(event);
    expect(effect?.lastPaymentStatus).toBe('failed');
    expect(effect?.nextPaymentDueAt).toBeNull();
  });

  it('returns a null catalogEntityId (not the whole effect) when metadata names no firm', () => {
    const event = { type: 'invoice.paid', data: { object: { id: 'in_f3', amount_due: 100, amount_paid: 100, status: 'paid' } } };
    expect(investorInvoiceEffectFromEvent(event)?.catalogEntityId).toBeNull();
  });

  it('defers to the founder side when metadata names an org and no firm', () => {
    const event = {
      type: 'invoice.paid',
      data: { object: { id: 'in_f4', amount_due: 100, amount_paid: 100, status: 'paid', metadata: { org_id: 'o1' } } },
    };
    expect(investorInvoiceEffectFromEvent(event)).toBeNull();
  });

  it('founder and investor invoice mappers never cross over, same as the subscription mappers', () => {
    const founderInvoice = { type: 'invoice.paid', data: { object: { id: 'in_x', amount_due: 100, amount_paid: 100, status: 'paid', metadata: { org_id: 'o1' } } } };
    const investorInvoice = { type: 'invoice.paid', data: { object: { id: 'in_y', amount_due: 100, amount_paid: 100, status: 'paid', metadata: { catalog_entity_id: 'firm-1' } } } };
    expect(investorInvoiceEffectFromEvent(founderInvoice)).toBeNull();
    expect(invoiceEffectFromEvent(founderInvoice)).toMatchObject({ orgId: 'o1' });
    expect(invoiceEffectFromEvent(investorInvoice)).toBeNull();
    expect(investorInvoiceEffectFromEvent(investorInvoice)).toMatchObject({ catalogEntityId: 'firm-1' });
  });
});

describe('a tradução de tiers usada pelo webhook', () => {
  it('round-trips every investor tier through the MatchDeal codes', () => {
    for (const p of INVESTOR_PLANS) {
      const code = INVESTOR_PLAN_TO_MATCHDEAL_TIER[p.tier];
      expect(MATCHDEAL_TIER_TO_INVESTOR_PLAN[code]).toBe(p.tier);
    }
  });
});

describe('os 6 preços confirmados pelo Nuno (Prompt 501)', () => {
  it('matches the confirmed table exactly, with no pending flags left', () => {
    expect(INVESTOR_PLANS.map((p) => [p.tier, p.monthlyEur, p.annualEur, p.annualPerMonthEur])).toEqual([
      ['pro_scout', 130, 1200, 100],
      ['ace_spotter', 240, 2220, 185],
      ['legendary_sleuth', 450, 4140, 345],
    ]);
    expect(INVESTOR_PLANS.some((p) => 'annualPending' in p)).toBe(false);
  });
});
