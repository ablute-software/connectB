// Prompt 501 — Customer Portal do Stripe do lado INVESTIDOR (facturas, cartão,
// trocar de tier, cancelar). Mesmo padrão de /api/stripe/portal; a única
// diferença é de onde vem o customer: da FIRMA do investidor autenticado
// (investor_billing.catalog_entity_id), não de `orgs`.
//
// Trocar de tier é SÓ aqui, como do lado founder — não há UI de troca dentro
// da app. As mudanças feitas no portal voltam pelo mesmo webhook.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { investorBillingConfigured, stripeSecret } from '@/lib/stripe-env';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { APP_URL } from '@/lib/brand';

export async function POST(req: Request) {
  if (!investorBillingConfigured()) {
    return NextResponse.json({ ok: false, error: 'Billing not configured.' }, { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor profile yet.' }, { status: 403 });

  // O customer id nunca sai daqui para o cliente — só a URL do portal. É
  // também por isto que investor_billing não precisa de ser legível por
  // ninguém a não ser o service role (ver migração 0287).
  const { data: billing } = await admin.from('investor_billing')
    .select('stripe_customer_id').eq('catalog_entity_id', member.catalog_entity_id).maybeSingle();
  const customer = billing?.stripe_customer_id as string | undefined;
  if (!customer) return NextResponse.json({ ok: false, error: 'No subscription to manage.' }, { status: 400 });

  const form = new URLSearchParams();
  form.set('customer', customer);
  // Ver a nota em investor-checkout: a tab é um query param de /portal.
  form.set('return_url', `${APP_URL}/portal?tab=plans`);

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('Stripe investor portal error:', (await res.text()).slice(0, 300));
    return NextResponse.json({ ok: false, error: 'Could not open the billing portal.' }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json({ ok: true, url: data.url as string });
}
