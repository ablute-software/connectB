// Prompt 854 §B.4 — generates ONE promo_codes row from the outreach row's
// own offer fields and points promo_code_id at it. One code registry, two
// ways in: the generated code appears on /backoffice/promo-codes too, as an
// ordinary row in the same table.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { buildOutreachPromoCode, normalizeDiscountForKind, type OutreachCategory, type PromoKind } from '@/lib/promo';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: target, error: fetchErr } = await admin
    .from('promo_outreach_targets').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  // Idempotent — a row that already has a code returns that code and
  // creates nothing. The unique partial index on promo_code_id is the
  // backstop against two outreach rows ever sharing one code.
  if (target.promo_code_id) {
    const { data: existingPromo } = await admin.from('promo_codes').select('code').eq('id', target.promo_code_id).maybeSingle();
    return NextResponse.json({ ok: true, code: existingPromo?.code ?? null, alreadyGenerated: true });
  }

  const plans = (target.applicable_plans as string[]) ?? [];
  if (plans.length === 0) {
    return NextResponse.json({ ok: false, error: 'Select at least one plan before generating a code.' }, { status: 400 });
  }

  const { data: existingCodes } = await admin.from('promo_codes').select('code');
  const taken = new Set((existingCodes ?? []).map((c) => c.code as string));

  const pct = normalizeDiscountForKind(target.kind as PromoKind, target.discount_pct as number);
  const code = buildOutreachPromoCode(
    target.name as string, target.category as OutreachCategory, pct, (c) => taken.has(c),
  );

  const { data: promo, error: insertErr } = await admin.from('promo_codes').insert({
    code,
    label: `Outreach — ${target.name}`,
    kind: target.kind,
    discount_pct: pct,
    applicable_plans: plans,
    redeemable_until: target.redeemable_until,
    benefit_duration_months: target.benefit_duration_months,
    max_redemptions: target.max_redemptions,
    created_by: userId,
    is_pioneer: false,
  }).select('id, code').single();
  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });

  // Conditional on promo_code_id still being null — a defensive guard
  // against two concurrent "Generate" clicks on the same row racing each
  // other. Whichever update lands first wins; the loser's own freshly
  // created promo_codes row is simply never referenced (harmless, just
  // unused) and this response reports the WINNING code instead of its own.
  const { data: updated } = await admin
    .from('promo_outreach_targets')
    .update({ promo_code_id: promo.id, updated_at: new Date().toISOString() })
    .eq('id', params.id).is('promo_code_id', null).select('id').maybeSingle();

  if (!updated) {
    const { data: row2 } = await admin.from('promo_outreach_targets').select('promo_code_id').eq('id', params.id).maybeSingle();
    const winningId = row2?.promo_code_id as string | undefined;
    const { data: winningPromo } = winningId
      ? await admin.from('promo_codes').select('code').eq('id', winningId).maybeSingle() : { data: null };
    return NextResponse.json({ ok: true, code: winningPromo?.code ?? code, alreadyGenerated: true });
  }

  // Prompt 854 §B.4 — the same action name the manual promo-codes path
  // already logs (promo_codes/route.ts POST), so the audit log has one
  // vocabulary for "a code was created"; `detail.source` says which door.
  await logAdminAction(admin, {
    adminUserId: userId, action: 'promo_code_created', subjectType: 'promo_code', subjectId: promo.id,
    detail: { source: 'outreach', outreach_id: params.id, code, kind: target.kind, discount_pct: pct },
  });

  return NextResponse.json({ ok: true, code: promo.code });
}
