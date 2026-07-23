// Billing — the Stripe webhook. THE only writer of orgs.plan via billing
// (the manual back-office set-plan stays as an override for comps/support).
// Signature-verified against STRIPE_WEBHOOK_SECRET (raw body + HMAC-SHA256, no
// SDK), then the pure billingEffectFromEvent maps the event to a plan change,
// applied with the service role. Idempotent by nature — replaying an event
// re-applies the same terminal state.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { stripeConfigured, stripePriceMap, stripeWebhookSecret } from '@/lib/stripe-env';
import { billingEffectFromEvent, parseStripeSigHeader } from '@/lib/billing';

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

export async function POST(req: Request) {
  const secret = stripeWebhookSecret();
  if (!stripeConfigured() || !secret) return NextResponse.json({ received: false }, { status: 200 });

  const raw = await req.text();
  if (!verify(raw, req.headers.get('stripe-signature'), secret, Math.floor(Date.now() / 1000))) {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return new NextResponse('Bad payload', { status: 400 }); }

  const effect = billingEffectFromEvent(event as Record<string, unknown>, stripePriceMap());
  if (!effect) return NextResponse.json({ received: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  }
  return NextResponse.json({ received: true });
}
