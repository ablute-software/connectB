// Prompt 244/245 — action 2 of 3: "Suspender X horas/dias". Goes through
// the SAME applyModerationAction() state machine the Startups/Investors
// tabs use (moderation-actions.ts) — never a second, parallel suspend
// implementation — just with an explicit suspendedUntilHours instead of
// the plain flow's indefinite default.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';
import { applyModerationAction } from '@/lib/moderation-actions';
import { validateSuspendHours } from '@/lib/suspend-hours';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  // Prompt 870 §B — the "Indefinite" preset sends hours: null; that is a valid
  // indefinite suspension, not a 400. Only a present-but-out-of-range value is
  // rejected.
  const { hours, justification } = await req.json().catch(() => ({})) as { hours?: number | null; justification?: string };
  const check = validateSuspendHours(hours);
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  if (!justification?.trim()) return NextResponse.json({ ok: false, error: 'A justification is required.' }, { status: 400 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('id, target_type, target_id').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });

  const result = await applyModerationAction(admin, {
    targetType: flag.target_type, targetId: flag.target_id, action: 'suspend',
    justification, actorId: userId,
    // Omit for an indefinite suspension (moderation_suspended_until stays null).
    ...(check.indefinite ? {} : { suspendedUntilHours: hours as number }),
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  const { data: modRow } = await admin.from('account_moderation_actions')
    .select('id').eq('target_type', flag.target_type).eq('target_id', flag.target_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const { error: logErr } = await admin.from('suspicious_account_flag_actions').insert({
    flag_id: params.id, action_type: 'suspend', suspend_hours: check.indefinite ? null : hours,
    moderation_action_id: modRow?.id ?? null, actor: userId, notes: justification,
  });
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  await admin.from('suspicious_account_flags').update({ status: 'actioned' }).eq('id', params.id);

  return NextResponse.json({ ok: true });
}
