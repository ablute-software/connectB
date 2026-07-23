// Billing — create a Stripe Checkout Session (subscription mode) and return its
// URL for the client to redirect to. Owner/admin only. Env-gated: returns a
// soft "not configured" until Stripe is wired, so the Plans page keeps its
// request-to-back-office fallback. Raw fetch (no SDK). No card data ever
// touches this code — Checkout collects it on Stripe's hosted page.
//
// IVA/tax: automatic_tax is intentionally NOT enabled — enabling Stripe Tax
// (and how EU B2B reverse-charge / VAT IDs are handled) is a founder decision,
// flagged in DECISIONS.md, not guessed here.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { stripeConfigured, stripePriceMap, stripeSecret } from '@/lib/stripe-env';
import { priceIdFor } from '@/lib/billing';
import { PLAN_TIERS } from '@/lib/plans';
import { APP_URL } from '@/lib/brand';
import type { PlanTier } from '@/lib/types';

export async function POST(req: Request) {
  if (!stripeConfigured()) return NextResponse.json({ ok: false, error: 'Billing not configured.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return NextResponse.json({ ok: false, error: 'Só o owner/admin pode alterar a subscrição.' }, { status: 403 });
  }

  const { tier, period } = await req.json() as { tier?: string; period?: string };
  if (!tier || !PLAN_TIERS.includes(tier as PlanTier) || tier === 'idea') {
    return NextResponse.json({ ok: false, error: 'Plano inválido.' }, { status: 400 });
  }
  const pd: 'monthly' | 'annual' = period === 'annual' ? 'annual' : 'monthly';
  const priceId = priceIdFor(tier as PlanTier, pd, stripePriceMap());
  if (!priceId) return NextResponse.json({ ok: false, error: 'Preço indisponível.' }, { status: 400 });

  const { data: org } = await sb.from('orgs').select('stripe_customer_id').eq('id', member.org_id).maybeSingle();

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  // Return URLs from APP_URL (canonical domain) so the cutover is one env change.
  form.set('success_url', `${APP_URL}/plans?checkout=success`);
  form.set('cancel_url', `${APP_URL}/plans?checkout=cancel`);
  form.set('client_reference_id', member.org_id as string);
  // Metadata carries org_id on BOTH the session and the subscription, so every
  // downstream webhook event can resolve the org without a lookup.
  form.set('metadata[org_id]', member.org_id as string);
  form.set('metadata[user_id]', user.id);
  form.set('metadata[tier]', tier);
  form.set('metadata[period]', pd);
  form.set('subscription_data[metadata][org_id]', member.org_id as string);
  form.set('subscription_data[metadata][tier]', tier);
  form.set('subscription_data[metadata][period]', pd);
  const existingCustomer = org?.stripe_customer_id as string | undefined;
  if (existingCustomer) form.set('customer', existingCustomer);
  else if (user.email) form.set('customer_email', user.email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('Stripe checkout error:', (await res.text()).slice(0, 300));
    return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o pagamento.' }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json({ ok: true, url: data.url as string });
}
