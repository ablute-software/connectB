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
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { stripeConfigured, stripePriceMap, stripeSecret } from '@/lib/stripe-env';
import { priceIdFor } from '@/lib/billing';
import { PLAN_TIERS } from '@/lib/plans';
import { isRedemptionCurrentlyActive } from '@/lib/promo';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';
import { PIONEER_LIFETIME_DISCOUNT_PCT, PIONEER_STRIPE_COUPON_ID } from '@/lib/pioneer';
import { APP_URL } from '@/lib/brand';
import type { PlanTier } from '@/lib/types';

// Prompt 163 B — the org's best active app-promo redemption covering this
// tier, as the shape the coupon step below needs. Same query and the same
// isRedemptionCurrentlyActive rule /api/promo/status already uses (promo.ts
// is the single source of that rule — deliberately not re-derived here);
// "best" = highest discount_pct, matching PlansPanel.tsx's own bestPromo
// display pick, so the founder is never charged a worse discount than the
// one the app showed them.
async function bestActiveRedemptionFor(orgId: string, tier: PlanTier) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: redemptions } = await admin
    .from('promo_redemptions')
    .select('benefit_ends_at, promo_codes(id, discount_pct, applicable_plans, benefit_duration_months, active, deleted_at)')
    .eq('org_id', orgId);
  const now = new Date();
  const candidates = (redemptions ?? [])
    .map((r) => ({ promo: r.promo_codes as unknown as { id: string; discount_pct: number; applicable_plans: string[]; benefit_duration_months: number | null; active: boolean; deleted_at: string | null } | null, benefit_ends_at: r.benefit_ends_at }))
    .filter((r) => r.promo && isRedemptionCurrentlyActive(r.promo, r.benefit_ends_at, now))
    .filter((r) => (r.promo!.applicable_plans ?? []).includes(tier))
    .sort((a, b) => b.promo!.discount_pct - a.promo!.discount_pct);
  return candidates[0]?.promo ?? null;
}

// Create-or-reuse a Stripe Coupon mirroring the app promo. Deterministic id
// (promo-{promo_code_id}) makes this idempotent with no new DB column: the
// first checkout creates it, every later one hits resource_already_exists
// and reuses it. One caveat that id scheme carries (flagged, accepted as
// part of the approved design): Stripe coupons are immutable, so if a
// promo_codes row's discount_pct were ever EDITED after the coupon exists,
// the old percentage would keep applying — today the backoffice has no
// edit-pct action (only deactivate/delete), so this is theoretical.
async function ensureStripeCoupon(promo: { id: string; discount_pct: number; benefit_duration_months: number | null }): Promise<string | null> {
  const couponId = `promo-${promo.id}`;
  const form = new URLSearchParams();
  form.set('id', couponId);
  form.set('percent_off', String(promo.discount_pct));
  if (promo.benefit_duration_months == null) {
    // benefit_duration_months null = the discount never expires once
    // redeemed (promo.ts's own documented semantics) -> permanent.
    form.set('duration', 'forever');
  } else {
    form.set('duration', 'repeating');
    form.set('duration_in_months', String(promo.benefit_duration_months));
  }
  const res = await fetch('https://api.stripe.com/v1/coupons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (res.ok) return couponId;
  const body = await res.json().catch(() => null) as { error?: { code?: string } } | null;
  if (body?.error?.code === 'resource_already_exists') return couponId;
  console.error('Stripe coupon create error:', JSON.stringify(body?.error ?? {}).slice(0, 300));
  return null;
}

// Prompt 161 §C.3 — "20% de desconto vitalício em qualquer plano pago
// futuro", ligado a orgs.pioneer_badge (permanent) instead of an active
// promo_redemptions row (temporary) — same create-or-reuse idempotency
// pattern as ensureStripeCoupon above, but ONE shared coupon id for every
// Pioneer org (pioneer.ts's PIONEER_STRIPE_COUPON_ID) rather than one per
// promo_codes row, since this discount isn't tied to any specific code.
async function ensurePioneerStripeCoupon(): Promise<string | null> {
  const form = new URLSearchParams();
  form.set('id', PIONEER_STRIPE_COUPON_ID);
  form.set('percent_off', String(PIONEER_LIFETIME_DISCOUNT_PCT));
  form.set('duration', 'forever');
  const res = await fetch('https://api.stripe.com/v1/coupons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (res.ok) return PIONEER_STRIPE_COUPON_ID;
  const body = await res.json().catch(() => null) as { error?: { code?: string } } | null;
  if (body?.error?.code === 'resource_already_exists') return PIONEER_STRIPE_COUPON_ID;
  console.error('Stripe pioneer coupon create error:', JSON.stringify(body?.error ?? {}).slice(0, 300));
  return null;
}

async function orgHasPioneerBadge(orgId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service || !(await pioneerBadgeAvailable())) return false;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data } = await admin.from('orgs').select('pioneer_badge').eq('id', orgId).maybeSingle();
  return !!data?.pioneer_badge;
}

export async function POST(req: Request) {
  if (!stripeConfigured()) return NextResponse.json({ ok: false, error: 'Billing not configured.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return NextResponse.json({ ok: false, error: 'Only the owner/admin can change the subscription.' }, { status: 403 });
  }

  const { tier, period } = await req.json() as { tier?: string; period?: string };
  if (!tier || !PLAN_TIERS.includes(tier as PlanTier) || tier === 'idea') {
    return NextResponse.json({ ok: false, error: 'Invalid plan.' }, { status: 400 });
  }
  const pd: 'monthly' | 'annual' = period === 'annual' ? 'annual' : 'monthly';
  const priceId = priceIdFor(tier as PlanTier, pd, stripePriceMap());
  if (!priceId) return NextResponse.json({ ok: false, error: 'Price unavailable.' }, { status: 400 });

  const { data: org } = await sb.from('orgs').select('stripe_customer_id').eq('id', member.org_id).maybeSingle();

  // Prompt 163 B — the fix for the Prompt 151-documented gap: an app promo
  // redemption (promo_codes/promo_redemptions) now becomes a REAL Stripe
  // coupon applied to this Checkout Session automatically, instead of the
  // app showing a discount Stripe never charged. No redemption -> exactly
  // the old behavior (allow_promotion_codes for Dashboard-native codes).
  //
  // Prompt 161 §C.3 — a permanent Pioneer badge also grants a lifetime 20%
  // discount on ANY future paid plan, independent of any active
  // promo_redemptions row (the trial itself may have long since expired —
  // that's the whole point of "permanent"). Whichever discount is BETTER
  // wins — a Pioneer who also happens to hold a still-active, higher-value
  // campaign promo is never charged worse than either alone would give them.
  const activePromo = await bestActiveRedemptionFor(member.org_id as string, tier as PlanTier);
  const isPioneer = await orgHasPioneerBadge(member.org_id as string);
  let couponId: string | null = null;
  if (activePromo && activePromo.discount_pct >= PIONEER_LIFETIME_DISCOUNT_PCT) {
    couponId = await ensureStripeCoupon(activePromo);
  } else if (isPioneer) {
    couponId = await ensurePioneerStripeCoupon();
  } else if (activePromo) {
    couponId = await ensureStripeCoupon(activePromo);
  }
  if ((activePromo || isPioneer) && !couponId) {
    // Coupon creation failed for an unexpected reason. Proceeding without
    // it would silently charge full price to a founder the app told has a
    // discount — the exact bug this fix closes — so fail loudly instead.
    return NextResponse.json({ ok: false, error: 'Could not apply your promo discount — try again.' }, { status: 502 });
  }

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  if (couponId) {
    // Stripe rejects discounts[] and allow_promotion_codes on the same
    // request — when the app promo applies, it wins and the manual
    // promotion-code field is omitted.
    form.set('discounts[0][coupon]', couponId);
  } else {
    // Prompt 151 — without this, Stripe's own Checkout screen doesn't even
    // show a field to enter a Promotion Code, so a real code created in the
    // Stripe Dashboard (e.g. for a discounted test payment) had no way to
    // ever be applied.
    form.set('allow_promotion_codes', 'true');
  }
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
    return NextResponse.json({ ok: false, error: 'Could not start checkout.' }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json({ ok: true, url: data.url as string });
}
