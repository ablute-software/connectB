// Promo Codes & Offers — back-office list + create. Platform admin only
// (requirePlatformAdmin, same defense-in-depth pattern as every other
// /api/backoffice/* route: middleware already blocks non-admins, this
// re-checks independently).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { PROMO_ELIGIBLE_PLANS, normalizeDiscountForKind, normalizePromoCodeInput, type PromoKind } from '@/lib/promo';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';
import type { PlanTier } from '@/lib/types';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: promos, error } = await admin
    .from('promo_codes')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { data: redemptions } = await admin.from('promo_redemptions').select('promo_code_id');
  const counts = new Map<string, number>();
  for (const r of redemptions ?? []) counts.set(r.promo_code_id, (counts.get(r.promo_code_id) ?? 0) + 1);

  return NextResponse.json({
    ok: true,
    promos: (promos ?? []).map((p) => ({ ...p, redemption_count: counts.get(p.id) ?? 0 })),
  });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({}));
  const {
    code, label, kind, discount_pct, applicable_plans,
    redeemable_until, benefit_duration_months, max_redemptions, is_pioneer,
  } = body as Record<string, unknown>;

  if (typeof code !== 'string' || !code.trim()) {
    return NextResponse.json({ ok: false, error: 'Code is required.' }, { status: 400 });
  }
  if (kind !== 'percent_off' && kind !== 'free_trial') {
    return NextResponse.json({ ok: false, error: 'Invalid promo type.' }, { status: 400 });
  }
  const pct = normalizeDiscountForKind(kind as PromoKind, Number(discount_pct));
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    return NextResponse.json({ ok: false, error: 'Discount must be between 1 and 100%.' }, { status: 400 });
  }
  const plans = Array.isArray(applicable_plans) ? applicable_plans.filter((p): p is PlanTier => PROMO_ELIGIBLE_PLANS.includes(p as PlanTier)) : [];
  if (plans.length === 0) {
    return NextResponse.json({ ok: false, error: 'Select at least one plan.' }, { status: 400 });
  }
  const durationMonths = benefit_duration_months == null || benefit_duration_months === '' ? null : Number(benefit_duration_months);
  if (durationMonths != null && (!Number.isInteger(durationMonths) || durationMonths <= 0)) {
    return NextResponse.json({ ok: false, error: 'Benefit duration must be a positive number of months, or left blank for permanent.' }, { status: 400 });
  }
  const maxRedemptions = max_redemptions == null || max_redemptions === '' ? null : Number(max_redemptions);
  if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
    return NextResponse.json({ ok: false, error: 'Redemption limit must be a positive whole number, or left blank for unlimited.' }, { status: 400 });
  }

  const normalizedCode = normalizePromoCodeInput(code);
  // Prompt 161 §A.2 — campaign codes (public, accelerators, investor
  // portfolios) are always created with is_pioneer=true from the
  // back-office; a one-off discount stays false (the default). Only
  // written when the migration's landed — omitting the key entirely on an
  // unmigrated environment, rather than sending `undefined` through, keeps
  // the insert from erroring on a column that doesn't exist yet.
  const pioneerFields = await pioneerBadgeAvailable() ? { is_pioneer: is_pioneer === true } : {};
  const { data: promo, error } = await admin.from('promo_codes').insert({
    code: normalizedCode,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
    kind,
    discount_pct: pct,
    applicable_plans: plans,
    redeemable_until: redeemable_until || null,
    benefit_duration_months: durationMonths,
    max_redemptions: maxRedemptions,
    created_by: userId,
    ...pioneerFields,
  }).select('*').single();

  if (error) {
    // Unique violation on `code` reads as a normal validation error to the
    // admin, not a 500 — they typed a code that already exists.
    if (error.code === '23505') return NextResponse.json({ ok: false, error: 'That code already exists.' }, { status: 409 });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAdminAction(admin, { adminUserId: userId, action: 'promo_code_created', subjectType: 'promo_code', subjectId: promo.id, detail: { code: normalizedCode, kind, discount_pct: pct } });

  return NextResponse.json({ ok: true, promo });
}
