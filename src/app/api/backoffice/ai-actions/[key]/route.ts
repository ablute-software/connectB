// Prompt 706 Bloco C.3 — edit one action's label/cost/confirmation flag, or
// flip the `enabled` kill switch. charge_ai_action (the Postgres RPC) reads
// this table live on every call, so a change here takes effect on the very
// next request — no deploy, no cache to bust.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  // Prompt 748 §C — same root cause found and fixed on the sibling
  // ai-plans routes on this same screen: admin_audit_log.subject_id is
  // uuid-typed, and this route always passed the action's natural-string
  // key, so its audit insert has been silently rejected the same way,
  // since the route was written. Fetched before the update so the audit
  // entry can carry {from, to} instead of only the new value.
  const { data: existing, error: existingErr } = await admin.from('ai_actions').select('*').eq('key', params.key).maybeSingle();
  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    label?: string; creditCost?: number; needsConfirmation?: boolean; enabled?: boolean;
  };
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.label !== undefined) {
    if (!body.label.trim()) return NextResponse.json({ ok: false, error: 'Label cannot be empty.' }, { status: 400 });
    update.label = body.label;
  }
  if (body.creditCost !== undefined) {
    if (!Number.isInteger(body.creditCost) || body.creditCost <= 0) {
      return NextResponse.json({ ok: false, error: 'Credit cost must be a positive whole number.' }, { status: 400 });
    }
    update.credit_cost = body.creditCost;
  }
  if (body.needsConfirmation !== undefined) update.needs_confirmation = body.needsConfirmation;
  if (body.enabled !== undefined) update.enabled = body.enabled;

  const { data, error } = await admin.from('ai_actions').update(update).eq('key', params.key).select('*').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
  const auditResult = await logAdminAction(admin, {
    adminUserId: userId, action: 'ai_action_update', subjectType: 'ai_actions', subjectId: null,
    detail: {
      actionKey: params.key, actionLabel: data.label,
      from: { label: existing.label, creditCost: existing.credit_cost, needsConfirmation: existing.needs_confirmation, enabled: existing.enabled },
      to: { label: data.label, creditCost: data.credit_cost, needsConfirmation: data.needs_confirmation, enabled: data.enabled },
    },
  });
  return NextResponse.json({ ok: true, action: data, auditWarning: !auditResult.ok });
}
