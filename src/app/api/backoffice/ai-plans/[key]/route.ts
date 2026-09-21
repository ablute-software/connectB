// Prompt 706 Bloco C.1 — edit or delete one plan (built-in or custom).
// Editing monthly_ai_credits works for ANY plan (built-in tiers included —
// that's the whole point of "no deploy needed to adjust a limit"); deleting
// is restricted to custom plans only, since a built-in tier's key is
// referenced by orgs.plan's FK and by src/lib/plans.ts's own PLAN_TIERS.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { label, monthlyAiCredits } = await req.json().catch(() => ({})) as { label?: string; monthlyAiCredits?: number };
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (label !== undefined) {
    if (!label.trim()) return NextResponse.json({ ok: false, error: 'Label cannot be empty.' }, { status: 400 });
    update.label = label;
  }
  if (monthlyAiCredits !== undefined) {
    if (!Number.isInteger(monthlyAiCredits) || monthlyAiCredits < 0) {
      return NextResponse.json({ ok: false, error: 'Monthly AI credits must be a non-negative whole number.' }, { status: 400 });
    }
    update.monthly_ai_credits = monthlyAiCredits;
  }

  const { data, error } = await admin.from('plans').update(update).eq('key', params.key).select('*').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
  await logAdminAction(admin, { adminUserId: userId, action: 'ai_plan_update', subjectType: 'plans', subjectId: params.key, detail: update });
  return NextResponse.json({ ok: true, plan: data });
}

export async function DELETE(_req: Request, { params }: { params: { key: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: plan } = await admin.from('plans').select('is_custom').eq('key', params.key).maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
  if (!plan.is_custom) return NextResponse.json({ ok: false, error: 'Built-in plans cannot be deleted.' }, { status: 400 });

  const { count } = await admin.from('orgs').select('id', { count: 'exact', head: true }).eq('plan', params.key);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: `${count} org(s) are still on this plan — move them first.` }, { status: 400 });
  }

  const { error } = await admin.from('plans').delete().eq('key', params.key);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAdminAction(admin, { adminUserId: userId, action: 'ai_plan_delete', subjectType: 'plans', subjectId: params.key });
  return NextResponse.json({ ok: true });
}
