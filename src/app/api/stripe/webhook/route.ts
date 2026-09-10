// Billing — the Stripe webhook. THE only writer of orgs.plan via billing
// (the manual back-office set-plan stays as an override for comps/support).
// Signature-verified against STRIPE_WEBHOOK_SECRET (raw body + HMAC-SHA256, no
// SDK), then the pure billingEffectFromEvent maps the event to a plan change,
// applied with the service role. Idempotent by nature — replaying an event
// re-applies the same terminal state.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  investorBillingConfigured, investorStripePriceMap,
  stripeConfigured, stripePriceMap, stripeWebhookSecret,
} from '@/lib/stripe-env';
import {
  billingEffectFromEvent, investorBillingEffectFromEvent, invoiceEffectFromEvent,
  investorInvoiceEffectFromEvent, parseStripeSigHeader,
} from '@/lib/billing';
import { applyPlanChangeSideEffects } from '@/lib/plan-sync';
import { applyInvestorTierToFirm } from '@/lib/investor-plan-apply';
import { INVESTOR_PLAN_TO_MATCHDEAL_TIER } from '@/lib/plans';
import { accessStateForSubscription } from '@/lib/investor-billing-access';

const TOLERANCE_SECONDS = 5 * 60;

function verify(rawBody: string, sigHeader: string | null, secret: string, nowSec: number): boolean {
  if (!sigHeader) return false;
  const { timestamp, v1 } = parseStripeSigHeader(sigHeader);
  if (!timestamp || v1.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  return v1.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

// Prompt 874 — the reverse-lookup fallback that investor_billing's own
// migration 0287 anticipated (its `investor_billing_subscription_idx` comment
// says as much) but that neither existing handler above ever actually
// implements — confirmed by reading both before writing this. Invoice events
// do not reliably carry the checkout-time metadata (recent Stripe API
// versions nest subscription metadata under `subscription_details.metadata`
// rather than copying it to the invoice's own top-level `metadata`, and even
// that may be empty), so when metadata is silent, this is what resolves the
// invoice to a founder org or an investor firm — by the one field an invoice
// always carries: its Stripe customer id.
async function resolveSubjectIdByCustomer(
  admin: SupabaseClient,
  table: 'orgs' | 'investor_billing',
  idColumn: 'id' | 'catalog_entity_id',
  stripeCustomerId: string | undefined,
): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const { data, error } = await admin
    .from(table)
    .select(idColumn)
    .eq('stripe_customer_id', stripeCustomerId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as Record<string, string>;
  return row[idColumn] ?? null;
}

export async function POST(req: Request) {
  // Prompt 501 — UM endpoint, DOIS lados. O gate passa a ser "pelo menos um
  // dos lados configurado": com o `stripeConfigured()` sozinho, ligar só o
  // billing do investidor deixaria este webhook a recusar os seus próprios
  // eventos. Os dois lados partilham secret e webhook secret (mesma conta
  // Stripe, mesmo endpoint); o que os separa é a metadata de cada evento.
  const secret = stripeWebhookSecret();
  if ((!stripeConfigured() && !investorBillingConfigured()) || !secret) {
    return NextResponse.json({ received: false }, { status: 200 });
  }

  const raw = await req.text();
  if (!verify(raw, req.headers.get('stripe-signature'), secret, Math.floor(Date.now() / 1000))) {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return new NextResponse('Bad payload', { status: 400 }); }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Prompt 874 — invoice mirror, a third event family distinct from the two
  // below: invoiceEffectFromEvent/investorInvoiceEffectFromEvent return null
  // for every type except invoice.paid/invoice.payment_failed, so this never
  // overlaps checkout.session.completed or customer.subscription.*. Handled
  // first, ahead of the subscription paths, purely because it's independent
  // of them — order doesn't matter for correctness here.
  const invoiceInvestorEffect = investorInvoiceEffectFromEvent(event as Record<string, unknown>);
  const invoiceOrgEffect = invoiceEffectFromEvent(event as Record<string, unknown>);
  if ((invoiceInvestorEffect || invoiceOrgEffect) && url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false } });

    if (invoiceInvestorEffect) {
      const catalogEntityId = invoiceInvestorEffect.catalogEntityId
        ?? await resolveSubjectIdByCustomer(admin, 'investor_billing', 'catalog_entity_id', invoiceInvestorEffect.stripeCustomerId);
      if (!catalogEntityId) {
        console.error(`Stripe invoice webhook: could not resolve firm for invoice=${invoiceInvestorEffect.stripeInvoiceId} (no metadata, no stripe_customer_id match)`);
      } else {
        const row = {
          kind: 'investor_entity' as const,
          catalog_entity_id: catalogEntityId,
          org_id: null,
          stripe_invoice_id: invoiceInvestorEffect.stripeInvoiceId,
          stripe_customer_id: invoiceInvestorEffect.stripeCustomerId ?? null,
          stripe_subscription_id: invoiceInvestorEffect.stripeSubscriptionId,
          amount_due_cents: invoiceInvestorEffect.amountDueCents,
          amount_paid_cents: invoiceInvestorEffect.amountPaidCents,
          currency: invoiceInvestorEffect.currency,
          status: invoiceInvestorEffect.status,
          period_start: invoiceInvestorEffect.periodStart,
          period_end: invoiceInvestorEffect.periodEnd,
          due_date: invoiceInvestorEffect.dueDate,
          paid_at: invoiceInvestorEffect.paidAt,
          hosted_invoice_url: invoiceInvestorEffect.hostedInvoiceUrl,
          updated_at: new Date().toISOString(),
        };
        const { error: invErr } = await admin.from('billing_invoices').upsert(row, { onConflict: 'stripe_invoice_id' });
        if (invErr) console.error('Stripe invoice webhook: billing_invoices upsert (investor) failed:', invErr.message);

        // invoice.payment_failed leaves next_payment_due_at untouched — the
        // key is only set on the patch when invoice.paid actually produced one.
        const patch: Record<string, unknown> = { last_payment_status: invoiceInvestorEffect.lastPaymentStatus };
        if (invoiceInvestorEffect.nextPaymentDueAt) patch.next_payment_due_at = invoiceInvestorEffect.nextPaymentDueAt;
        const { error: colErr } = await admin.from('investor_billing').update(patch).eq('catalog_entity_id', catalogEntityId);
        if (colErr) console.error('Stripe invoice webhook: investor_billing denorm update failed:', colErr.message);
      }
    }

    if (invoiceOrgEffect) {
      const orgId = invoiceOrgEffect.orgId
        ?? await resolveSubjectIdByCustomer(admin, 'orgs', 'id', invoiceOrgEffect.stripeCustomerId);
      if (!orgId) {
        console.error(`Stripe invoice webhook: could not resolve org for invoice=${invoiceOrgEffect.stripeInvoiceId} (no metadata, no stripe_customer_id match)`);
      } else {
        const row = {
          kind: 'org' as const,
          org_id: orgId,
          catalog_entity_id: null,
          stripe_invoice_id: invoiceOrgEffect.stripeInvoiceId,
          stripe_customer_id: invoiceOrgEffect.stripeCustomerId ?? null,
          stripe_subscription_id: invoiceOrgEffect.stripeSubscriptionId,
          amount_due_cents: invoiceOrgEffect.amountDueCents,
          amount_paid_cents: invoiceOrgEffect.amountPaidCents,
          currency: invoiceOrgEffect.currency,
          status: invoiceOrgEffect.status,
          period_start: invoiceOrgEffect.periodStart,
          period_end: invoiceOrgEffect.periodEnd,
          due_date: invoiceOrgEffect.dueDate,
          paid_at: invoiceOrgEffect.paidAt,
          hosted_invoice_url: invoiceOrgEffect.hostedInvoiceUrl,
          updated_at: new Date().toISOString(),
        };
        const { error: invErr } = await admin.from('billing_invoices').upsert(row, { onConflict: 'stripe_invoice_id' });
        if (invErr) console.error('Stripe invoice webhook: billing_invoices upsert (org) failed:', invErr.message);

        const patch: Record<string, unknown> = { last_payment_status: invoiceOrgEffect.lastPaymentStatus };
        if (invoiceOrgEffect.nextPaymentDueAt) patch.next_payment_due_at = invoiceOrgEffect.nextPaymentDueAt;
        const { error: colErr } = await admin.from('orgs').update(patch).eq('id', orgId);
        if (colErr) console.error('Stripe invoice webhook: orgs denorm update failed:', colErr.message);
      }
    }

    return NextResponse.json({ received: true });
  }

  // Lado investidor primeiro, e os dois são mutuamente exclusivos por
  // construção: um evento de founder traz `metadata.org_id` e nenhum
  // `catalog_entity_id`, um de investidor traz o inverso, e cada função
  // devolve null quando a sua chave falta. Não há evento que caia nos dois.
  const investorEffect = investorBillingEffectFromEvent(event as Record<string, unknown>, investorStripePriceMap());
  if (investorEffect && url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    // Prompt 506 — dois casos, tratados de forma diferente (decisão do Nuno:
    // "se descer escolherá o plano adequado. se deixar de pagar fica sem
    // acesso até pagar"):
    //
    //   A PAGAR (checkout novo, ou troca de tier no portal) -> aplica o tier
    //   escolhido a TODOS os assentos activos da firma, pela mesma função que
    //   o backoffice usa (applyInvestorTierToFirm) — um plano é da firma, não
    //   de quem carregou no botão. E limpa o bloqueio: a reactivação é
    //   automática, sem passo manual nenhum, porque é o mesmo webhook.
    //
    //   SEM PAGAR (customer.subscription.deleted, ou um update que resolve
    //   para nada) -> NÃO toca em matchdeal_profiles.plan_tier. O Prompt 501
    //   descia ao piso 'tier_a' aqui, que dava Pro Scout de graça a quem
    //   parou de pagar. Agora o bloqueio vive em investor_billing.access_state
    //   e o tier fica como estava, a servir de memória do último plano ("
    //   Reactivate Ace Spotter"). Não há valor de plan_tier que signifique
    //   "nenhum" — ver a migração 0288 para as duas medições que o provam.
    const paying = investorEffect.tier !== null;
    const accessState = accessStateForSubscription(paying);
    let matchdealTier: string | null = null;

    if (paying) {
      matchdealTier = INVESTOR_PLAN_TO_MATCHDEAL_TIER[investorEffect.tier!];
      const applied = await applyInvestorTierToFirm(admin, investorEffect.catalogEntityId, matchdealTier);
      if (applied.error) {
        // Registado, não devolvido como falha: um 500 faria o Stripe repetir o
        // evento indefinidamente por algo que uma nova tentativa não resolve
        // (uma firma sem assentos activos continuará sem assentos). O estado do
        // billing abaixo é gravado à mesma, para o portal continuar a abrir.
        console.error(`Stripe investor webhook: could not apply tier for firm=${investorEffect.catalogEntityId}:`, applied.error);
      }
    }

    const full: Record<string, unknown> = {
      catalog_entity_id: investorEffect.catalogEntityId,
      stripe_customer_id: investorEffect.stripeCustomerId,
      stripe_subscription_id: investorEffect.stripeSubscriptionId,
      // Num cancelamento fica `undefined` e é descartado pelo filtro abaixo —
      // investor_billing.plan_tier guarda o ÚLTIMO tier pago e não deve ser
      // apagado por deixar de pagar; é dele que sai o "Reactivate X".
      plan_tier: matchdealTier ?? undefined,
      billing_period: paying ? investorEffect.period : undefined,
      access_state: accessState,
      updated_at: new Date().toISOString(),
    };
    // undefined é descartado (o Stripe nem sempre repete o customer em todos
    // os eventos); null é mantido, para um cancelamento limpar mesmo a
    // subscrição em vez de a deixar para trás.
    const patch = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined));
    const { error } = await admin.from('investor_billing').upsert(patch, { onConflict: 'catalog_entity_id' });
    if (error) console.error('Stripe investor webhook: investor_billing upsert failed:', error.message);
    return NextResponse.json({ received: true });
  }

  const effect = billingEffectFromEvent(event as Record<string, unknown>, stripePriceMap());
  if (!effect) return NextResponse.json({ received: true });

  if (url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    // Full patch (plan + Stripe cols). undefined keys are dropped; null is kept
    // so a cancel clears the subscription id.
    const full: Record<string, unknown> = {
      plan: effect.plan,
      stripe_customer_id: effect.stripeCustomerId,
      stripe_subscription_id: effect.stripeSubscriptionId,
      stripe_billing_period: effect.period,
    };
    const patch = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined));
    const { error } = await admin.from('orgs').update(patch).eq('id', effect.orgId);
    // Resilient to migration 0031 not being applied yet: the plan sync (the
    // column that gates AI etc.) still lands even if the stripe_* columns don't
    // exist. Billing should not be enabled before 0031, but this fails safe.
    if (error) await admin.from('orgs').update({ plan: effect.plan }).eq('id', effect.orgId);
    await applyPlanChangeSideEffects(admin, effect.orgId, effect.plan);
  }
  return NextResponse.json({ received: true });
}
