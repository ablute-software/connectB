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

  // Prompt 748 §C — fetched BEFORE the update so the audit entry can carry
  // {from, to} rather than just the new value. A `detail` that only ever
  // says "monthly_ai_credits: 80" can't tell anyone what it used to be —
  // exactly the gap that let the 24/09 mix-up go unnoticed.
  const { data: existing, error: existingErr } = await admin.from('plans').select('*').eq('key', params.key).maybeSingle();
  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });

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
  // Prompt 748 §C — subjectId: null, not the plan's key: admin_audit_log.
  // subject_id is uuid-typed and a plan key never is, so this insert has
  // been silently rejected by Postgres on every call since the route was
  // written (confirmed: zero ai_plan_update rows in production despite
  // this call always firing) — logAdminAction never checked its own
  // error, so nothing surfaced anywhere. The key now travels in `detail`,
  // alongside the before/after values.
  const auditResult = await logAdminAction(admin, {
    adminUserId: userId, action: 'ai_plan_update', subjectType: 'plans', subjectId: null,
    detail: {
      planKey: params.key, planLabel: data.label,
      from: { label: existing.label, monthlyAiCredits: existing.monthly_ai_credits },
      to: { label: data.label, monthlyAiCredits: data.monthly_ai_credits },
    },
  });
  return NextResponse.json({ ok: true, plan: data, auditWarning: !auditResult.ok });
}

export async function DELETE(_req: Request, { params }: { params: { key: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: plan } = await admin.from('plans').select('label, is_custom').eq('key', params.key).maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
  if (!plan.is_custom) return NextResponse.json({ ok: false, error: 'Built-in plans cannot be deleted.' }, { status: 400 });

  const { count } = await admin.from('orgs').select('id', { count: 'exact', head: true }).eq('plan', params.key);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: `${count} org(s) are still on this plan — move them first.` }, { status: 400 });
  }

  const { error } = await admin.from('plans').delete().eq('key', params.key);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const auditResult = await logAdminAction(admin, { adminUserId: userId, action: 'ai_plan_delete', subjectType: 'plans', subjectId: null, detail: { planKey: params.key, planLabel: plan.label } });
  return NextResponse.json({ ok: true, auditWarning: !auditResult.ok });
}
