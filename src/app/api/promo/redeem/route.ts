// Founder-facing promo code redemption. Owner/admin only (same gate as
// checkout/plan-request — this affects what the org pays, same class of
// action). Writes through the service role, same as every other
// public/founder-facing write in this codebase — RLS on promo_redemptions
// is locked to platform_admin, by design (0040).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { promoEligibility, computeBenefitEndsAt, normalizePromoCodeInput, type PromoKind } from '@/lib/promo';

const REASON_MESSAGE: Record<string, string> = {
  not_found: 'That code doesn’t exist. Check for typos and try again.',
  deleted: 'That code is no longer available.',
  inactive: 'That code is no longer active.',
  expired: 'That code has expired.',
  redemption_limit_reached: 'That code has reached its redemption limit.',
};

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return NextResponse.json({ ok: false, error: 'Only the owner/admin can apply a promo code.' }, { status: 403 });
  }

  const { code } = await req.json().catch(() => ({})) as { code?: string };
  if (!code || !code.trim()) return NextResponse.json({ ok: false, error: 'Enter a code.' }, { status: 400 });
  const normalizedCode = normalizePromoCodeInput(code);

  const { data: promo } = await admin.from('promo_codes').select('*').eq('code', normalizedCode).maybeSingle();

  const { count: redemptionCount } = await admin
    .from('promo_redemptions').select('id', { count: 'exact', head: true })
    .eq('promo_code_id', promo?.id ?? '00000000-0000-0000-0000-000000000000');

  const reason = promoEligibility(promo, redemptionCount ?? 0, new Date());
  if (reason) return NextResponse.json({ ok: false, error: REASON_MESSAGE[reason] ?? 'That code can’t be used.' }, { status: 400 });

  const { data: existing } = await admin
    .from('promo_redemptions').select('id')
    .eq('promo_code_id', promo!.id).eq('org_id', member.org_id).maybeSingle();
  if (existing) return NextResponse.json({ ok: false, error: 'You’ve already redeemed this code.' }, { status: 400 });

  const redeemedAt = new Date();
  const benefitEndsAt = computeBenefitEndsAt(redeemedAt, promo!.benefit_duration_months);

  const { error: insertErr } = await admin.from('promo_redemptions').insert({
    promo_code_id: promo!.id,
    org_id: member.org_id,
    redeemed_by: user.id,
    redeemed_at: redeemedAt.toISOString(),
    benefit_ends_at: benefitEndsAt ? benefitEndsAt.toISOString() : null,
  });
  // Race with another tab/request hitting the same unique(promo_code_id,
  // org_id) constraint at the same instant — treat like "already redeemed",
  // not a server error.
  if (insertErr) {
    if (insertErr.code === '23505') return NextResponse.json({ ok: false, error: 'You’ve already redeemed this code.' }, { status: 400 });
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    kind: promo!.kind as PromoKind,
    discount_pct: promo!.discount_pct as number,
    applicable_plans: promo!.applicable_plans as string[],
    benefit_ends_at: benefitEndsAt ? benefitEndsAt.toISOString() : null,
  });
}
