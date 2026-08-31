// Prompt 501 — os dois gates de billing, e a propriedade que os separa:
// nenhum dos lados pode desligar o outro. Não é um teste decorativo — é a
// razão pela qual `investorBillingConfigured()` existe em vez de alargar
// `stripeConfigured()`. O billing do founder está VIVO em produção: um gate
// único apagaria o checkout do founder no instante em que este código lá
// chegasse sem os 6 price IDs de investidor existirem no Stripe.
//
// O primeiro caso é literalmente o estado em que isto vai para produção hoje
// (nenhuma env de investidor definida): os dois lados sabem que não estão
// configurados, e o painel do investidor cai no fluxo de pedido manual.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FOUNDER_PRICE_KEYS = [
  'STRIPE_PRICE_GARAGE_MONTHLY', 'STRIPE_PRICE_GARAGE_ANNUAL',
  'STRIPE_PRICE_MOTHERFUNDING_MONTHLY', 'STRIPE_PRICE_MOTHERFUNDING_ANNUAL',
];
const INVESTOR_PRICE_KEYS = [
  'STRIPE_PRICE_PRO_SCOUT_MONTHLY', 'STRIPE_PRICE_PRO_SCOUT_ANNUAL',
  'STRIPE_PRICE_ACE_SPOTTER_MONTHLY', 'STRIPE_PRICE_ACE_SPOTTER_ANNUAL',
  'STRIPE_PRICE_LEGENDARY_SLEUTH_MONTHLY', 'STRIPE_PRICE_LEGENDARY_SLEUTH_ANNUAL',
];
const ALL = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', ...FOUNDER_PRICE_KEYS, ...INVESTOR_PRICE_KEYS];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of ALL) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ALL) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

// Os gates lêem process.env na CHAMADA, não no import — é isso que torna
// possível trocar o ambiente entre casos sem invalidar módulos.
import { investorBillingConfigured, stripeConfigured } from './stripe-env';

function setSecrets() {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
}

describe('os dois gates de billing são independentes', () => {
  it('ambos desligados sem env nenhuma — o estado em que isto entra em produção', () => {
    expect(stripeConfigured()).toBe(false);
    expect(investorBillingConfigured()).toBe(false);
  });

  it('o founder acende sozinho, SEM nenhum dos 6 preços de investidor', () => {
    setSecrets();
    for (const k of FOUNDER_PRICE_KEYS) process.env[k] = 'price_x';
    expect(stripeConfigured()).toBe(true);
    expect(investorBillingConfigured()).toBe(false);
  });

  it('o investidor acende sozinho, SEM nenhum dos 4 preços do founder', () => {
    setSecrets();
    for (const k of INVESTOR_PRICE_KEYS) process.env[k] = 'price_x';
    expect(investorBillingConfigured()).toBe(true);
    expect(stripeConfigured()).toBe(false);
  });

  it('meio configurado não conta — falta um dos 6 e o lado investidor fica escuro', () => {
    setSecrets();
    for (const k of INVESTOR_PRICE_KEYS.slice(0, -1)) process.env[k] = 'price_x';
    expect(investorBillingConfigured()).toBe(false);
  });

  it('sem os segredos partilhados nenhum dos lados acende, por mais preços que existam', () => {
    for (const k of [...FOUNDER_PRICE_KEYS, ...INVESTOR_PRICE_KEYS]) process.env[k] = 'price_x';
    expect(stripeConfigured()).toBe(false);
    expect(investorBillingConfigured()).toBe(false);
  });
});
