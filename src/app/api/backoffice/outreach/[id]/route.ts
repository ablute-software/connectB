// Prompt 854 §B.6 — the edit lock that prevents a silent overcharge.
// /api/stripe/checkout's own comment says Stripe coupons are immutable and
// that this was "theoretical today because the back-office has no edit-pct
// action" — this route is what makes it real, so it's the one that has to
// enforce the lock: once promo_code_id is set, the offer fields become
// read-only, both here (409) and in the UI (page.tsx disables the inputs).
// name/contact fields/status/contacted_on/notes stay editable forever.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import type { OutreachCategory } from '@/lib/promo';

const CATEGORIES: OutreachCategory[] = ['startup', 'accelerator', 'incubator', 'program'];
const STATUSES = ['to_contact', 'contacted', 'replied', 'no_reply', 'declined'];
// The fields that become part of the issued Stripe coupon (or would be, the
// moment a founder redeems the generated code) — locked the instant
// promo_code_id is set.
const OFFER_FIELDS = ['kind', 'discount_pct', 'applicable_plans', 'redeemable_until', 'benefit_duration_months', 'max_redemptions'] as const;
const EDITABLE_ALWAYS = ['name', 'category', 'website', 'email', 'phone', 'status', 'contacted_on', 'notes'] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: target, error: fetchErr } = await admin
    .from('promo_outreach_targets').select('id, promo_code_id').eq('id', params.id).is('deleted_at', null).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const requestedKeys = Object.keys(body);
  const touchesOfferField = requestedKeys.some((k) => (OFFER_FIELDS as readonly string[]).includes(k));
  if (target.promo_code_id && touchesOfferField) {
    return NextResponse.json({
      ok: false,
      error: 'The promo code for this row is already issued — deactivate it and create a new row to change the offer.',
    }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of requestedKeys) {
    if (!(EDITABLE_ALWAYS as readonly string[]).includes(key) && !(!target.promo_code_id && (OFFER_FIELDS as readonly string[]).includes(key))) continue;
    patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
  }
  if (patch.category !== undefined && !CATEGORIES.includes(patch.category as OutreachCategory)) {
    return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 });
  }
  if (patch.status !== undefined && !STATUSES.includes(patch.status as string)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) {
    return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });
  }

  patch.updated_at = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('promo_outreach_targets').update(patch).eq('id', params.id).select('*').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, target: updated });
}
