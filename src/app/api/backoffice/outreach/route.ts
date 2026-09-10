// Prompt 854 §B — the Marketing group's outreach table: list + create.
// Platform admin only (requirePlatformAdmin), same defense-in-depth pattern
// as every other /api/backoffice/* route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { PROMO_ELIGIBLE_PLANS, normalizeDiscountForKind, isOutreachArchived, type PromoKind } from '@/lib/promo';
import type { OutreachCategory } from '@/lib/promo';
import type { PlanTier } from '@/lib/types';

const CATEGORIES: OutreachCategory[] = ['startup', 'accelerator', 'incubator', 'program', 'vc'];

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: rows, error } = await admin
    .from('promo_outreach_targets')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // The derived "Redeemed" column — a fact from promo_redemptions, never an
  // opinion typed into the row (migration 0343's own header comment). One
  // batched query rather than N, same reasoning as promo-codes' own list.
  const codeIds = (rows ?? []).map((r) => r.promo_code_id).filter((id): id is string => !!id);
  const redemptionsByCode = new Map<string, { orgId: string; orgName: string }[]>();
  if (codeIds.length > 0) {
    const { data: redemptions } = await admin
      .from('promo_redemptions')
      .select('promo_code_id, org_id, orgs(name)')
      .in('promo_code_id', codeIds);
    for (const r of redemptions ?? []) {
      const org = r.orgs as unknown as { name: string } | null;
      const list = redemptionsByCode.get(r.promo_code_id as string) ?? [];
      list.push({ orgId: r.org_id as string, orgName: org?.name ?? '(deleted org)' });
      redemptionsByCode.set(r.promo_code_id as string, list);
    }
  }

  // Prompt 876 §D — the same batched codes query now also carries what
  // isOutreachArchived needs (redeemable_until, max_redemptions), so
  // is_archived costs no extra round trip beyond what "Redeemed" already paid.
  const codesById = new Map<string, { code: string; redeemable_until: string | null; max_redemptions: number | null }>();
  if (codeIds.length > 0) {
    const { data: codes } = await admin.from('promo_codes').select('id, code, redeemable_until, max_redemptions').in('id', codeIds);
    for (const c of codes ?? []) {
      codesById.set(c.id as string, { code: c.code as string, redeemable_until: c.redeemable_until as string | null, max_redemptions: c.max_redemptions as number | null });
    }
  }

  const now = new Date();
  return NextResponse.json({
    ok: true,
    targets: (rows ?? []).map((r) => {
      const codeInfo = r.promo_code_id ? (codesById.get(r.promo_code_id as string) ?? null) : null;
      const redemptionCount = r.promo_code_id ? (redemptionsByCode.get(r.promo_code_id as string) ?? []).length : 0;
      return {
        ...r,
        promo_code: codeInfo?.code ?? null,
        redeemed: r.promo_code_id ? (redemptionsByCode.get(r.promo_code_id as string) ?? []) : [],
        is_archived: isOutreachArchived(codeInfo, redemptionCount, now),
      };
    }),
  });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const {
    name, category, kind, discount_pct, applicable_plans, redeemable_until, benefit_duration_months, max_redemptions,
    website, email, phone,
    // Prompt 876 §A — recipient_name/recipient_email describe the startup
    // that will RECEIVE the code (distinct from `name`, the program/VC's
    // own name, and from email/phone above, the program/VC's own contact
    // channel). contact_person_name/program_info describe the program/VC
    // side in more detail. All four optional.
    recipient_name, recipient_email, contact_person_name, program_info,
  } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });
  }
  if (typeof category !== 'string' || !CATEGORIES.includes(category as OutreachCategory)) {
    return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 });
  }
  if (kind !== 'percent_off' && kind !== 'free_trial') {
    return NextResponse.json({ ok: false, error: 'Invalid offer type.' }, { status: 400 });
  }
  const pct = normalizeDiscountForKind(kind as PromoKind, Number(discount_pct));
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    return NextResponse.json({ ok: false, error: 'Discount must be between 1 and 100%.' }, { status: 400 });
  }
  const plans = Array.isArray(applicable_plans)
    ? applicable_plans.filter((p): p is PlanTier => PROMO_ELIGIBLE_PLANS.includes(p as PlanTier)) : [];
  const durationMonths = benefit_duration_months == null || benefit_duration_months === '' ? null : Number(benefit_duration_months);
  if (durationMonths != null && (!Number.isInteger(durationMonths) || durationMonths <= 0)) {
    return NextResponse.json({ ok: false, error: 'Benefit duration must be a positive number of months, or left blank for permanent.' }, { status: 400 });
  }
  const maxRedemptions = max_redemptions == null || max_redemptions === '' ? null : Number(max_redemptions);
  if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
    return NextResponse.json({ ok: false, error: 'Redemption limit must be a positive whole number, or left blank for unlimited.' }, { status: 400 });
  }

  const { data: target, error } = await admin.from('promo_outreach_targets').insert({
    name: name.trim(),
    category,
    kind,
    discount_pct: pct,
    applicable_plans: plans,
    redeemable_until: redeemable_until || null,
    benefit_duration_months: durationMonths,
    max_redemptions: maxRedemptions,
    website: typeof website === 'string' && website.trim() ? website.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim() : null,
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    recipient_name: typeof recipient_name === 'string' && recipient_name.trim() ? recipient_name.trim() : null,
    recipient_email: typeof recipient_email === 'string' && recipient_email.trim() ? recipient_email.trim() : null,
    contact_person_name: typeof contact_person_name === 'string' && contact_person_name.trim() ? contact_person_name.trim() : null,
    program_info: typeof program_info === 'string' && program_info.trim() ? program_info.trim() : null,
    created_by: userId,
  }).select('*').single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, target: { ...target, promo_code: null, redeemed: [] } });
}
