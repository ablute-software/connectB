// Billing — pure, I/O-free core for Stripe subscriptions. Unit-tested; the
// checkout/portal/webhook routes compose these. No SDK, no env reads here (the
// env half lives in stripe-env.ts) — everything below is deterministic given
// its inputs, so price-ID resolution, the webhook event→plan mapping, and the
// downgrade semantics are all testable without a live Stripe or a signature.
import type { PlanTier } from './types';
import type { BillingPeriod, InvestorPlanTier } from './plans';
import { INVESTOR_PLANS, normalizePlan } from './plans';

// Derivado de INVESTOR_PLANS para não poder ficar dessincronizado de um tier
// novo (o mesmo raciocínio "ordem do array é a fonte" que plans.ts já usa).
const INVESTOR_PLAN_TIERS = INVESTOR_PLANS.map((p) => p.tier);

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

// ===== Invoice mirror (Prompt 874) =====
// A local mirror of invoice.paid / invoice.payment_failed events, one row per
// billing cycle in billing_invoices (migration
// 20260910083000_billing_invoices_mirror.sql) — an invoice is a repeating
// fact, not a subscription-level attribute, so it doesn't belong squeezed
// into orgs/investor_billing beyond the two denormalized read columns those
// tables already got.
//
// Field choices below, made explicit per this prompt's own instruction to
// flag an assumption rather than silently reshape the schema:
//   - paid_at            <- status_transitions.paid_at. Invoice has no
//                            top-level `paid_at`; status_transitions is
//                            Stripe's own record of when each transition
//                            happened.
//   - next_payment_due_at (invoice.paid only) <- period_end. A raw invoice
//                            webhook payload carries no expanded subscription
//                            object, so there is no `current_period_end` to
//                            read; period_end is the invoice's own record of
//                            when the period it covers ends, which for a
//                            subscription invoice is the next charge point —
//                            the cleanest available signal, not a guess at an
//                            undocumented field. invoice.payment_failed
//                            leaves it null (the route then leaves the column
//                            untouched), per this prompt's own instruction.
//   - status              <- read straight off the invoice object itself
//                            ('draft'|'open'|'paid'|'uncollectible'|'void'),
//                            not inferred from the event type; it already
//                            matches billing_invoices' check constraint.
//   - org/firm metadata   <- checked at obj.metadata first, then at
//                            obj.subscription_details.metadata (recent Stripe
//                            API versions nest subscription metadata there
//                            rather than copying it onto the invoice's own
//                            top-level metadata). When BOTH come up empty,
//                            these pure functions return a null subject id —
//                            the caller (the webhook route, which can do I/O)
//                            is responsible for the stripe_customer_id
//                            reverse-lookup fallback. Confirmed by reading
//                            billing.ts + the webhook route in full before
//                            writing this: neither existing subscription
//                            handler (billingEffectFromEvent /
//                            investorBillingEffectFromEvent) implements such
//                            a fallback today — despite investor_billing's
//                            own migration 0287 already carrying a comment
//                            and an index that anticipated one — so this is
//                            new code, not a reuse of an existing path.

function invoiceMetadataOf(obj: Record<string, unknown>): Record<string, string> {
  const top = (obj.metadata ?? {}) as Record<string, string>;
  if (top.org_id || top.catalog_entity_id) return top;
  const subDetails = obj.subscription_details as { metadata?: Record<string, string> } | undefined;
  return subDetails?.metadata ?? top;
}

function toIsoFromUnixSeconds(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null;
}

interface InvoiceFields {
  stripeInvoiceId: string;
  stripeCustomerId: string | undefined;
  stripeSubscriptionId: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  /** Set only on invoice.paid; null on invoice.payment_failed (column stays untouched). */
  nextPaymentDueAt: string | null;
  lastPaymentStatus: 'paid' | 'failed';
}

// Shared by both sides — the invoice payload shape and field semantics are
// identical; only the subject id (org vs. firm) differs, extracted by each
// caller below. This is deliberately NOT split into two copies the way the
// founder/investor plan logic above is: that split exists because the two
// domains have genuinely different vocabularies (a free tier vs. none, two
// different target tables); an invoice's own fields don't vary by side.
function extractInvoiceFields(type: string | undefined, obj: Record<string, unknown>): InvoiceFields | null {
  if (type !== 'invoice.paid' && type !== 'invoice.payment_failed') return null;
  if (typeof obj.id !== 'string') return null;
  const statusTransitions = (obj.status_transitions ?? {}) as Record<string, unknown>;
  const periodEndIso = toIsoFromUnixSeconds(obj.period_end);
  const lastPaymentStatus: 'paid' | 'failed' = type === 'invoice.paid' ? 'paid' : 'failed';
  return {
    stripeInvoiceId: obj.id,
    stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : undefined,
    stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : null,
    amountDueCents: typeof obj.amount_due === 'number' ? obj.amount_due : 0,
    amountPaidCents: typeof obj.amount_paid === 'number' ? obj.amount_paid : 0,
    currency: typeof obj.currency === 'string' ? obj.currency : 'eur',
    status: typeof obj.status === 'string' ? obj.status : (lastPaymentStatus === 'paid' ? 'paid' : 'open'),
    periodStart: toIsoFromUnixSeconds(obj.period_start),
    periodEnd: periodEndIso,
    dueDate: toIsoFromUnixSeconds(obj.due_date),
    paidAt: toIsoFromUnixSeconds(statusTransitions.paid_at),
    hostedInvoiceUrl: typeof obj.hosted_invoice_url === 'string' ? obj.hosted_invoice_url : null,
    nextPaymentDueAt: lastPaymentStatus === 'paid' ? periodEndIso : null,
    lastPaymentStatus,
  };
}

export interface InvoiceEffect extends InvoiceFields {
  /** null when metadata carries no org_id — caller resolves via stripe_customer_id. */
  orgId: string | null;
}

// Founder side. An event whose metadata names a catalog_entity_id (and no
// org_id) is the investor side's — returns null so the two never collide,
// the same mutual-exclusivity-by-construction the subscription handlers use.
export function invoiceEffectFromEvent(event: StripeEventLike): InvoiceEffect | null {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const fields = extractInvoiceFields(event.type, obj);
  if (!fields) return null;
  const meta = invoiceMetadataOf(obj);
  if (meta.catalog_entity_id && !meta.org_id) return null;
  return { ...fields, orgId: meta.org_id ?? null };
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

// ===== Investor billing (Prompt 501) =====
// O lado investidor, deliberadamente em funções PRÓPRIAS e não alargando as de
// cima. São dois domínios distintos, e forçá-los ao mesmo tipo seria mentira:
// o founder tem um tier gratuito ('idea') e escreve `orgs.plan`; o investidor
// não tem tier gratuito nenhum e escreve `matchdeal_profiles.plan_tier`, com
// um vocabulário diferente ('tier_a/b/c', não 'pro_scout/...'). O tenant
// também é outro — a FIRMA (`catalog_entity_id`), não a org.
//
// O que É partilhado, e por isso não está duplicado aqui: ACTIVE_SUBSCRIPTION_
// STATUSES (mesma semântica de dunning/cancelamento ao fim do período,
// incluindo `past_due`) e parseStripeSigHeader.

export interface InvestorStripePriceMap {
  pro_scout: { monthly?: string; annual?: string };
  ace_spotter: { monthly?: string; annual?: string };
  legendary_sleuth: { monthly?: string; annual?: string };
}

export function investorPriceIdFor(
  tier: InvestorPlanTier, period: BillingPeriod, prices: InvestorStripePriceMap,
): string | undefined {
  return prices[tier]?.[period];
}

export function investorTierForPriceId(
  priceId: string, prices: InvestorStripePriceMap,
): { tier: InvestorPlanTier; period: BillingPeriod } | undefined {
  for (const tier of INVESTOR_PLAN_TIERS) {
    for (const period of ['monthly', 'annual'] as const) {
      if (prices[tier]?.[period] && prices[tier][period] === priceId) return { tier, period };
    }
  }
  return undefined;
}

// O equivalente de planForSubscription, com a diferença que importa: não há
// tier gratuito para onde cair. Um estado não-pagante, ou um preço que não
// reconhecemos, resolve para `null` — "sem plano pago" — e é quem aplica o
// efeito decide o que fazer com isso. Prompt 506: esse "o que fazer" deixou
// de ser "descer ao piso" e passou a ser "bloquear o acesso"
// (investor_billing.access_state) — e é exactamente porque esta função
// devolve `null` em vez de já devolver um tier que essa mudança coube só no
// webhook: "o Stripe não diz nada de pago" nunca foi aqui traduzido para
// "esta firma é Pro Scout".
export function investorPlanForSubscription(
  status: string, priceId: string | undefined, prices: InvestorStripePriceMap,
): { tier: InvestorPlanTier | null; period: BillingPeriod | null } {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return { tier: null, period: null };
  const match = priceId ? investorTierForPriceId(priceId, prices) : undefined;
  return match ? { tier: match.tier, period: match.period } : { tier: null, period: null };
}

export interface InvestorBillingEffect {
  catalogEntityId: string;
  /** null = sem plano pago; quem aplica desce ao piso. */
  tier: InvestorPlanTier | null;
  period: BillingPeriod | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null; // null limpa (cancelamento)
}

// Mesma forma que billingEffectFromEvent, mas a chave da metadata é
// `catalog_entity_id` e não `org_id` — é isso que separa um evento de
// investidor de um de founder no MESMO endpoint de webhook, sem os dois se
// confundirem: um evento de founder não traz catalog_entity_id e devolve null
// aqui, um de investidor não traz org_id e devolve null lá.
export function investorBillingEffectFromEvent(
  event: { type?: string; data?: { object?: Record<string, unknown> } },
  prices: InvestorStripePriceMap,
): InvestorBillingEffect | null {
  const type = event.type;
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const catalogEntityId = meta.catalog_entity_id;
  if (!catalogEntityId) return null;

  if (type === 'checkout.session.completed') {
    const tier = meta.tier as InvestorPlanTier | undefined;
    if (!tier || !INVESTOR_PLAN_TIERS.includes(tier)) return null;
    return {
      catalogEntityId,
      tier,
      period: meta.period === 'annual' ? 'annual' : 'monthly',
      stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
    };
  }

  if (type === 'customer.subscription.updated') {
    const status = String(obj.status ?? '');
    const items = obj.items as { data?: { price?: { id?: string } }[] } | undefined;
    const { tier, period } = investorPlanForSubscription(status, items?.data?.[0]?.price?.id, prices);
    return {
      catalogEntityId,
      tier,
      period,
      stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      stripeSubscriptionId: tier === null ? null : (typeof obj.id === 'string' ? obj.id : undefined),
    };
  }

  if (type === 'customer.subscription.deleted') {
    // Downgrade SÓ aqui, igual ao founder: um pedido de cancelamento deixa a
    // subscrição 'active' até ao fim do período pago, e é este evento que
    // dispara nessa altura.
    return { catalogEntityId, tier: null, period: null, stripeSubscriptionId: null };
  }

  return null;
}

export interface InvestorInvoiceEffect extends InvoiceFields {
  /** null when metadata carries no catalog_entity_id — caller resolves via stripe_customer_id. */
  catalogEntityId: string | null;
}

// Investor side of the invoice mirror (Prompt 874) — see invoiceEffectFromEvent
// above for the shared field-extraction reasoning; this mirrors it with the
// firm's metadata key instead of the org's, same mutual-exclusivity guard.
export function investorInvoiceEffectFromEvent(
  event: { type?: string; data?: { object?: Record<string, unknown> } },
): InvestorInvoiceEffect | null {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const fields = extractInvoiceFields(event.type, obj);
  if (!fields) return null;
  const meta = invoiceMetadataOf(obj);
  if (meta.org_id && !meta.catalog_entity_id) return null;
  return { ...fields, catalogEntityId: meta.catalog_entity_id ?? null };
}
