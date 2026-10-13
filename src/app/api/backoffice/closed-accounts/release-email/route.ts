// Prompt 900 §B.2 — Release email: take ONE person out of a closed or deleted account so their e-mail can be used in another
// capacity (an ecosystem organisation, an investor firm) without resurrecting the startup. The account stays dead.
//
// All in one SQL function, moderation_release_org_member (migration 20261013160000): the platform-admin check, the refusals (a
// member in a GDPR erasure · a blocked e-mail · an owner-closed account still inside the owner's reopen window), the removal of the
// org_members row and the admin_audit_log entry, atomically. It never touches auth.users (the person keeps their login) and never
// touches blocked_emails (that list is a security decision with its own screen).
//
// One consequence that is the product's existing rule, not this route's: removing the LAST member of an account fires
// trg_orgs_close_when_last_member_removed → close_org(). The function reports it (`closedByThisRelease`) and the screen says it
// before the click.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { MIN_REASON_LENGTH, refusalMessage, refusalStatus } from '@/lib/closed-accounts';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { orgId, userId: memberId, reason } = await req.json().catch(() => ({})) as { orgId?: string; userId?: string; reason?: string };
  if (!orgId || !memberId) return NextResponse.json({ ok: false, error: 'orgId and userId are required.' }, { status: 400 });
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) return NextResponse.json({ ok: false, error: 'A reason is required (who asked, through which channel).' }, { status: 400 });

  const { data, error } = await admin.rpc('moderation_release_org_member', { p_org_id: orgId, p_user_id: memberId, p_reason: reason.trim(), p_actor: userId });
  if (error) return NextResponse.json({ ok: false, error: refusalMessage(error) }, { status: refusalStatus(error) });
  return NextResponse.json({ ok: true, result: data });
}
