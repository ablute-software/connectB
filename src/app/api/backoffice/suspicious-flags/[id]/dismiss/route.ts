// Prompt 574 §B.3 — "Dismiss (razão)": the one action that was previously
// entirely missing from SuspiciousFlagActions (alert_email/suspend/
// delete_and_block, per Prompt 244/245, had no way to say "reviewed, not
// suspicious" at all). Reuses the same suspicious_account_flag_actions log
// (action_type is a plain text column, not an enum — no migration needed
// to add this value) so a dismissed flag's reasoning has the same audit
// trail as every other action here, not a separate, second history.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { reason } = await req.json().catch(() => ({})) as { reason?: string };
  if (!reason?.trim()) return NextResponse.json({ ok: false, error: 'A reason is required to dismiss.' }, { status: 400 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('id').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });

  const { error: logErr } = await admin.from('suspicious_account_flag_actions').insert({
    flag_id: params.id, action_type: 'dismiss', actor: userId, notes: reason.trim(),
  });
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  await admin.from('suspicious_account_flags').update({ status: 'actioned' }).eq('id', params.id);

  return NextResponse.json({ ok: true });
}
