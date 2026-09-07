// Prompt 602 §A — a member changes their OWN password. The current one is
// required (a forgotten open laptop is not enough to swap the credential),
// every other session falls, and an email says it happened — date and
// origin, never the password.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { checkPassword } from '@/lib/password-policy';
import {
  currentSessionId, notifyPasswordChanged, recordSecurityEvent, requestOrigin, serviceAdmin, terminateSessions, verifyCurrentPassword,
} from '@/lib/account-security-server';

export async function POST(req: Request) {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not available in this workspace.' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) return NextResponse.json({ ok: false, error: 'Current and new password are required.' }, { status: 400 });
  if (!checkPassword(newPassword).valid) return NextResponse.json({ ok: false, error: 'The new password does not meet the requirements.' }, { status: 400 });
  if (currentPassword === newPassword) return NextResponse.json({ ok: false, error: 'The new password must be different from the current one.' }, { status: 400 });

  if (!(await verifyCurrentPassword(user.email, currentPassword))) {
    return NextResponse.json({ ok: false, error: 'The current password is incorrect.' }, { status: 401 });
  }

  // Service-role update after OUR check of the current password — independent
  // of the project's "secure password change" setting, and the server never
  // needs to hold the old credential beyond the probe above.
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword, user_metadata: { ...user.user_metadata, password_set: true } });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // §A — "terminar as outras sessões": GoTrue's own scope=others with this
  // session's JWT, and the server-side delete as the belt (a session the
  // JWT path missed cannot survive it). This session stays.
  await sb.auth.signOut({ scope: 'others' }).catch(() => undefined);
  const keep = await currentSessionId(sb);
  const ended = await terminateSessions(admin, user.id, keep);

  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  const orgId = (member?.org_id as string | undefined) ?? null;
  const { ip, userAgent } = requestOrigin(req);
  const now = new Date();
  await recordSecurityEvent(admin, { userId: user.id, orgId, kind: 'password_changed', actorUserId: user.id, ip, userAgent, detail: { otherSessionsEnded: ended } });
  const mail = await notifyPasswordChanged(user.email, orgId, now, ip, userAgent);

  return NextResponse.json({ ok: true, otherSessionsEnded: ended, emailSent: mail.sent });
}
