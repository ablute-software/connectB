// Prompt 900 §B.1 — Reopen account: an account deleted by moderation goes back to 'active' (quarantine and suspension clocks cleared),
// with who and why recorded. Everything that matters happens in ONE SQL function, moderation_reopen_org (migration 20261013160000):
// the platform-admin check, the refusals (not deleted · also closed · retention window ended · a member in a GDPR erasure · a blocked
// e-mail), the update and BOTH history rows (account_moderation_actions, admin_audit_log) in the same transaction — so this route
// writes no audit row of its own (it would be a duplicate) and a failure can never leave "reopened, nobody knows by whom".
//
// NOT the applyModerationAction state machine: that one treats every action it does not know as a DELETE, so 'reopen' must never be
// routed through it.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { MIN_REASON_LENGTH, refusalMessage, refusalStatus } from '@/lib/closed-accounts';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { orgId, reason } = await req.json().catch(() => ({})) as { orgId?: string; reason?: string };
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) return NextResponse.json({ ok: false, error: 'A reason is required (who asked, through which channel).' }, { status: 400 });

  const { data, error } = await admin.rpc('moderation_reopen_org', { p_org_id: orgId, p_reason: reason.trim(), p_actor: userId });
  if (error) return NextResponse.json({ ok: false, error: refusalMessage(error) }, { status: refusalStatus(error) });
  return NextResponse.json({ ok: true, result: data });
}
