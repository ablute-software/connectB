// Prompt 602 §B — the "this wasn't me" button in the owner's email. Public
// (the owner may not be signed in; the point is that they may have been
// locked out): a one-time token, hashed at rest, 7 days. On use: every
// session on the account ends, the current password stops working, and a
// fresh one-time reset link goes to the owner — nobody else. Then the login
// page says what happened.
import { NextResponse, type NextRequest } from 'next/server';
import { APP_URL } from '@/lib/brand';
import {
  generateRecoveryLink, hashToken, notifyAccountSecured, recordSecurityEvent, requestOrigin, rotatePasswordToRandom,
  serviceAdmin, terminateSessions, userEmail,
} from '@/lib/account-security-server';

export const dynamic = 'force-dynamic';

function toLogin(status: 'secured' | 'invalid') {
  return NextResponse.redirect(`${APP_URL}/login?account=${status}`);
}

export async function GET(req: NextRequest) {
  const admin = serviceAdmin();
  const raw = req.nextUrl.searchParams.get('token');
  if (!admin || !raw || raw.length < 32) return toLogin('invalid');

  const now = new Date();
  const { data: ev } = await admin.from('account_security_events')
    .select('id, user_id, org_id, token_expires_at, used_at')
    .eq('token_hash', hashToken(raw)).eq('kind', 'owner_reset_initiated').maybeSingle();
  if (!ev || ev.used_at || !ev.token_expires_at || new Date(ev.token_expires_at) < now || !ev.user_id) return toLogin('invalid');

  // Consume first — a second click must not run the lock twice.
  await admin.from('account_security_events').update({ used_at: now.toISOString() }).eq('id', ev.id);

  const ownerId = ev.user_id as string;
  const ended = await terminateSessions(admin, ownerId, null);
  const rotated = await rotatePasswordToRandom(admin, ownerId);
  const email = await userEmail(admin, ownerId);
  const resetLink = email ? await generateRecoveryLink(admin, email) : null;
  const mail = email && resetLink ? await notifyAccountSecured(email, ev.org_id as string | null, now, resetLink) : { sent: false };

  const { ip, userAgent } = requestOrigin(req);
  await recordSecurityEvent(admin, {
    userId: ownerId, orgId: ev.org_id as string | null, kind: 'owner_reset_disputed', actorUserId: ownerId, ip, userAgent,
    detail: { sessionsEnded: ended, passwordRotated: rotated, newLinkSent: mail.sent, disputedEventId: ev.id },
  });
  await admin.from('admin_audit_log').insert({
    admin_user_id: null, action: 'owner_password_reset_disputed', subject_type: 'user', subject_id: ownerId,
    detail: { orgId: ev.org_id, sessionsEnded: ended, passwordRotated: rotated, newLinkSent: mail.sent, disputedEventId: ev.id },
  });

  return toLogin('secured');
}
