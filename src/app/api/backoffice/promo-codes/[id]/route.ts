// Promo Codes & Offers — detail (with the redeeming orgs, join date, and
// benefit expiry), toggle active, and soft-delete ("eliminar/retirar").
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { benefitStillActive } from '@/lib/promo';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: promo, error } = await admin.from('promo_codes').select('*').eq('id', params.id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!promo) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const { data: redemptions } = await admin
    .from('promo_redemptions')
    .select('id, org_id, redeemed_at, benefit_ends_at, orgs(name)')
    .eq('promo_code_id', params.id)
    .order('redeemed_at', { ascending: false });

  const now = new Date();
  return NextResponse.json({
    ok: true,
    promo,
    redemptions: (redemptions ?? []).map((r) => ({
      id: r.id,
      org_id: r.org_id,
      org_name: (r.orgs as unknown as { name: string } | null)?.name ?? '(deleted org)',
      redeemed_at: r.redeemed_at,
      benefit_ends_at: r.benefit_ends_at,
      benefit_active: benefitStillActive(r.benefit_ends_at, now),
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { active } = await req.json().catch(() => ({})) as { active?: boolean };
  if (typeof active !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'active (boolean) is required.' }, { status: 400 });
  }

  const { data: promo, error } = await admin.from('promo_codes').update({ active }).eq('id', params.id).select('id, code').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!promo) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  await logAdminAction(admin, { adminUserId: userId, action: active ? 'promo_code_activated' : 'promo_code_deactivated', subjectType: 'promo_code', subjectId: promo.id, detail: { code: promo.code } });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  // Soft delete — a promo that already has real redemptions keeps its
  // history (who benefits, until when); only new redemptions stop.
  const { data: promo, error } = await admin
    .from('promo_codes')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', params.id)
    .select('id, code')
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!promo) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  await logAdminAction(admin, { adminUserId: userId, action: 'promo_code_deleted', subjectType: 'promo_code', subjectId: promo.id, detail: { code: promo.code } });

  return NextResponse.json({ ok: true });
}
