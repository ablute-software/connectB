// Prompt 244/245 — action 3 of 3: "Eliminar + bloquear o email", the ONE
// sanctioned exception to canDelete's 30-day quarantine wait (Prompt 245
// point 3, explicitly approved) — a flag from this queue can warrant
// immediate removal with no prior suspension at all. Delete still goes
// through the shared applyModerationAction() state machine, just with
// bypassQuarantine:true; that flag is always recorded (bypassed_quarantine
// column on account_moderation_actions), never silent, and canDelete()
// itself is untouched for every other caller (Startups/Investors tabs).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';
import { applyModerationAction } from '@/lib/moderation-actions';
import { blockEmail } from '@/lib/blocked-emails-server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { justification } = await req.json().catch(() => ({})) as { justification?: string };
  if (!justification?.trim()) return NextResponse.json({ ok: false, error: 'A justification is required.' }, { status: 400 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('id, target_type, target_id, email').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });
  // Combined action, per its own name — no email on file means there's
  // nothing to block, so this route (deliberately) refuses rather than
  // silently deleting without the "block" half.
  if (!flag.email) return NextResponse.json({ ok: false, error: 'This flag has no email on file to block.' }, { status: 400 });

  const result = await applyModerationAction(admin, {
    targetType: flag.target_type, targetId: flag.target_id, action: 'delete',
    justification, actorId: userId, bypassQuarantine: true,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  const blockResult = await blockEmail(admin, { email: flag.email, reason: justification, actorId: userId });
  if (!blockResult.ok) return NextResponse.json({ ok: false, error: `Deleted, but blocking the email failed: ${blockResult.error}` }, { status: 500 });

  const { data: modRow } = await admin.from('account_moderation_actions')
    .select('id').eq('target_type', flag.target_type).eq('target_id', flag.target_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const { error: logErr } = await admin.from('suspicious_account_flag_actions').insert({
    flag_id: params.id, action_type: 'delete_and_block',
    moderation_action_id: modRow?.id ?? null, actor: userId, notes: justification,
  });
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  await admin.from('suspicious_account_flags').update({ status: 'actioned' }).eq('id', params.id);

  return NextResponse.json({ ok: true });
}
