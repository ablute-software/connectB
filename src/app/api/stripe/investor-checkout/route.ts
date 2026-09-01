// Prompt 501 — checkout Stripe do lado INVESTIDOR. Espelho de
// /api/stripe/checkout, com as três diferenças que o domínio impõe:
//   1. o tenant é a FIRMA (`catalog_entity_id`), não a org — é isso que viaja
//      na metadata, e é a firma inteira que o pagamento cobre;
//   2. não há tier gratuito, portanto qualquer um dos 3 tiers é comprável;
//   3. uma firma só pode ter UMA subscrição activa (medição §3): se já tiver,
//      esta rota recusa e o painel mostra "Manage subscription" em vez de
//      "Subscribe".
//
// Iguais ao founder por decisão explícita do prompt: automatic_tax fica
// DESLIGADO (ligar o Stripe Tax e decidir o reverse-charge B2B da UE é uma
// decisão do founder, registada em DECISIONS.md, não adivinhada aqui). Sem
// cupões: ensureStripeCoupon do lado founder depende de promo_redemptions,
// que é uma tabela por ORG e não tem equivalente do lado investidor — não é
// reuso directo, portanto fica de fora, como o prompt permite.
//
// Nenhum dado de cartão passa por aqui: o Checkout recolhe-o na página alojada
// pelo Stripe. Raw fetch, sem SDK, mesmo padrão do resto do billing.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { investorBillingConfigured, investorStripePriceMap, stripeSecret } from '@/lib/stripe-env';
import { investorPriceIdFor } from '@/lib/billing';
import { INVESTOR_PLANS, type InvestorPlanTier } from '@/lib/plans';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { APP_URL } from '@/lib/brand';

export async function POST(req: Request) {
  // Mesmo contrato do founder quando o billing está desligado: 200 com
  // ok:false, para o painel cair no fluxo de pedido manual em vez de mostrar
  // um erro ao investidor.
  if (!investorBillingConfigured()) {
    return NextResponse.json({ ok: false, error: 'Billing not configured.' }, { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // Mesmo guarda que /api/portal/plan/request: um developer em modo "ver como"
  // nunca inicia um pagamento real em nome de outra pessoa.
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { tier, period } = await req.json() as { tier?: string; period?: string };
  if (!tier || !INVESTOR_PLANS.some((p) => p.tier === tier)) {
    return NextResponse.json({ ok: false, error: 'Invalid plan.' }, { status: 400 });
  }
  const pd: 'monthly' | 'annual' = period === 'annual' ? 'annual' : 'monthly';
  const priceId = investorPriceIdFor(tier as InvestorPlanTier, pd, investorStripePriceMap());
  if (!priceId) return NextResponse.json({ ok: false, error: 'Price unavailable.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor profile yet.' }, { status: 403 });
  const firmId = member.catalog_entity_id;

  // Uma subscrição por firma. O PK de investor_billing garante uma LINHA por
  // firma; esta verificação é o que garante que não se abre uma SEGUNDA
  // subscrição no Stripe enquanto a primeira está viva — trocar de tier
  // faz-se no portal, exactamente como do lado founder.
  const { data: existing } = await admin.from('investor_billing')
    .select('stripe_customer_id, stripe_subscription_id').eq('catalog_entity_id', firmId).maybeSingle();
  if (existing?.stripe_subscription_id) {
    return NextResponse.json({
      ok: false, hasSubscription: true,
      error: 'This firm already has an active subscription — change or cancel it in the billing portal.',
    }, { status: 409 });
  }

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('allow_promotion_codes', 'true');
  // O workspace do investidor vive em /portal com a tab por query param
  // (portal/page.tsx lê ?tab=) — não há rota /portal/plans. Confirmado antes
  // de escrever isto; um success_url para uma rota inexistente mandaria o
  // investidor para um 404 logo a seguir a pagar.
  form.set('success_url', `${APP_URL}/portal?tab=plans&checkout=success`);
  form.set('cancel_url', `${APP_URL}/portal?tab=plans&checkout=cancel`);
  form.set('client_reference_id', firmId);
  // A metadata carrega `catalog_entity_id` na Session E na Subscription — é a
  // chave por que o webhook distingue um evento de investidor de um de
  // founder (que traz `org_id`), sem lookup nenhum.
  form.set('metadata[catalog_entity_id]', firmId);
  form.set('metadata[user_id]', user.id);
  form.set('metadata[tier]', tier);
  form.set('metadata[period]', pd);
  form.set('subscription_data[metadata][catalog_entity_id]', firmId);
  form.set('subscription_data[metadata][tier]', tier);
  form.set('subscription_data[metadata][period]', pd);
  if (existing?.stripe_customer_id) form.set('customer', existing.stripe_customer_id as string);
  else if (user.email) form.set('customer_email', user.email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('Stripe investor checkout error:', (await res.text()).slice(0, 300));
    return NextResponse.json({ ok: false, error: 'Could not start checkout.' }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json({ ok: true, url: data.url as string });
}
