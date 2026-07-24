// Billing — open the Stripe Customer Portal (invoices, card, plan switch,
// cancel) for the org's existing customer. Owner/admin only. Plan changes made
// in the portal flow back through the same webhooks. Raw fetch, no SDK; no card
// data touches this code.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { stripeConfigured, stripeSecret } from '@/lib/stripe-env';
import { APP_URL } from '@/lib/brand';

export async function POST() {
  if (!stripeConfigured()) return NextResponse.json({ ok: false, error: 'Billing not configured.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return NextResponse.json({ ok: false, error: 'Only the owner/admin can manage the subscription.' }, { status: 403 });
  }

  const { data: org } = await sb.from('orgs').select('stripe_customer_id').eq('id', member.org_id).maybeSingle();
  const customer = org?.stripe_customer_id as string | undefined;
  if (!customer) return NextResponse.json({ ok: false, error: 'No subscription to manage.' }, { status: 400 });

  const form = new URLSearchParams();
  form.set('customer', customer);
  form.set('return_url', `${APP_URL}/plans`);

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('Stripe portal error:', (await res.text()).slice(0, 300));
    return NextResponse.json({ ok: false, error: 'Could not open the billing portal.' }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json({ ok: true, url: data.url as string });
}
