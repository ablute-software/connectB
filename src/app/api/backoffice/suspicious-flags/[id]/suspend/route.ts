// Prompt 244/245 — action 2 of 3: "Suspender X horas/dias". Goes through
// the SAME applyModerationAction() state machine the Startups/Investors
// tabs use (moderation-actions.ts) — never a second, parallel suspend
// implementation — just with an explicit suspendedUntilHours instead of
// the plain flow's indefinite default.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';
import { applyModerationAction } from '@/lib/moderation-actions';

// Sanity bound only — a developer can pick anything from a few hours to a
// year; there's no product reason to allow further than that from this
// specific form (an indefinite suspension is still available, unchanged,
// from the existing Startups/Investors tabs).
const MAX_SUSPEND_HOURS = 24 * 365;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { hours, justification } = await req.json().catch(() => ({})) as { hours?: number; justification?: string };
  if (!hours || !Number.isFinite(hours) || hours <= 0 || hours > MAX_SUSPEND_HOURS) {
    return NextResponse.json({ ok: false, error: `hours must be between 1 and ${MAX_SUSPEND_HOURS}.` }, { status: 400 });
  }
  if (!justification?.trim()) return NextResponse.json({ ok: false, error: 'A justification is required.' }, { status: 400 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('id, target_type, target_id').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });

  const result = await applyModerationAction(admin, {
    targetType: flag.target_type, targetId: flag.target_id, action: 'suspend',
    justification, actorId: userId, suspendedUntilHours: hours,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  const { data: modRow } = await admin.from('account_moderation_actions')
    .select('id').eq('target_type', flag.target_type).eq('target_id', flag.target_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const { error: logErr } = await admin.from('suspicious_account_flag_actions').insert({
    flag_id: params.id, action_type: 'suspend', suspend_hours: hours,
    moderation_action_id: modRow?.id ?? null, actor: userId, notes: justification,
  });
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  await admin.from('suspicious_account_flags').update({ status: 'actioned' }).eq('id', params.id);

  return NextResponse.json({ ok: true });
}
