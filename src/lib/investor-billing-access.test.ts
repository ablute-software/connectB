// Prompt 506 — cancelar deixa a firma SEM acesso, não no tier mais barato.
import { describe, expect, it } from 'vitest';
import { accessStateForSubscription, isBlockedState } from './investor-billing-access';
import { investorBillingEffectFromEvent, type InvestorStripePriceMap } from './billing';
import { INVESTOR_PLAN_TO_MATCHDEAL_TIER } from './plans';

const PRICES: InvestorStripePriceMap = {
  pro_scout: { monthly: 'price_ps_m', annual: 'price_ps_a' },
  ace_spotter: { monthly: 'price_as_m', annual: 'price_as_a' },
  legendary_sleuth: { monthly: 'price_ls_m', annual: 'price_ls_a' },
};

// A regra que o webhook aplica, isolada do webhook: `tier === null` é o
// "o Stripe não reporta nada de pago" que investorPlanForSubscription
// devolve, e é isso que tem de virar bloqueio.
const webhookDecision = (event: Parameters<typeof investorBillingEffectFromEvent>[0]) => {
  const effect = investorBillingEffectFromEvent(event, PRICES);
  if (!effect) return null;
  const paying = effect.tier !== null;
  return {
    accessState: accessStateForSubscription(paying),
    // undefined = não escrito, ou seja matchdeal_profiles.plan_tier fica como está
    matchdealTierWritten: paying ? INVESTOR_PLAN_TO_MATCHDEAL_TIER[effect.tier!] : undefined,
    subscriptionId: effect.stripeSubscriptionId,
  };
};

describe('isBlockedState — falha fechado no valor conhecido, aberto na ausência', () => {
  it('bloqueia payment_lapsed', () => {
    expect(isBlockedState('payment_lapsed')).toBe(true);
  });
  it('não bloqueia uma firma que nunca passou por billing (sem linha / sem valor)', () => {
    expect(isBlockedState(null)).toBe(false);
    expect(isBlockedState(undefined)).toBe(false);
    expect(isBlockedState('active')).toBe(false);
  });
  it('não bloqueia um valor que não conhece — nunca tranca alguém por um estado inesperado', () => {
    expect(isBlockedState('something_new')).toBe(false);
  });
});

describe('cancelamento — sem acesso, e NUNCA um tier de graça', () => {
  const deleted = {
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', metadata: { catalog_entity_id: 'firm-1' } } },
  };

  it('bloqueia o acesso', () => {
    expect(webhookDecision(deleted)!.accessState).toBe('payment_lapsed');
  });

  it('NÃO escreve tier nenhum em matchdeal_profiles — o bug que o 501 tinha', () => {
    // O 501 escrevia 'tier_a' aqui, dando Pro Scout de graça a quem parou de
    // pagar. Nenhum tier pode ser escrito num cancelamento.
    expect(webhookDecision(deleted)!.matchdealTierWritten).toBeUndefined();
  });

  it('limpa a subscrição', () => {
    expect(webhookDecision(deleted)!.subscriptionId).toBeNull();
  });

  it('um update que resolve para nada pago bloqueia igual', () => {
    const lapsed = webhookDecision({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'canceled', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_ls_m' } }] } } },
    })!;
    expect(lapsed.accessState).toBe('payment_lapsed');
    expect(lapsed.matchdealTierWritten).toBeUndefined();
  });
});

describe('descer de tier a pagar continua a ser uma troca, não um bloqueio', () => {
  it('Legendary Sleuth -> Pro Scout mantém o acesso e escreve o tier escolhido', () => {
    const d = webhookDecision({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_ps_m' } }] } } },
    })!;
    expect(d.accessState).toBe('active');
    expect(d.matchdealTierWritten).toBe('tier_a');
  });

  it('past_due (dunning) ainda é pagar — não bloqueia à primeira falha de cobrança', () => {
    const d = webhookDecision({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'past_due', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_as_m' } }] } } },
    })!;
    expect(d.accessState).toBe('active');
    expect(d.matchdealTierWritten).toBe('tier_b');
  });
});

describe('reactivação é automática — o mesmo webhook limpa o bloqueio', () => {
  it('um checkout novo depois de um cancelamento devolve o acesso, sem passo manual', () => {
    const cancelled = webhookDecision({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', metadata: { catalog_entity_id: 'firm-1' } } },
    })!;
    expect(cancelled.accessState).toBe('payment_lapsed');

    const reactivated = webhookDecision({
      type: 'checkout.session.completed',
      data: { object: { metadata: { catalog_entity_id: 'firm-1', tier: 'ace_spotter', period: 'monthly' }, customer: 'cus_1', subscription: 'sub_2' } },
    })!;
    expect(reactivated.accessState).toBe('active');
    expect(reactivated.matchdealTierWritten).toBe('tier_b');
    expect(reactivated.subscriptionId).toBe('sub_2');
  });

  it('reactivar no portal Stripe (subscription.updated a pagar) limpa igual', () => {
    expect(webhookDecision({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { catalog_entity_id: 'firm-1' }, items: { data: [{ price: { id: 'price_ls_a' } }] } } },
    })!.accessState).toBe('active');
  });
});

describe('accessStateForSubscription', () => {
  it('mapeia paga -> active, não paga -> payment_lapsed', () => {
    expect(accessStateForSubscription(true)).toBe('active');
    expect(accessStateForSubscription(false)).toBe('payment_lapsed');
  });
});
