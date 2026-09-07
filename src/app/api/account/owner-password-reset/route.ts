// Prompt 602 §B — the version built INSTEAD of "email the owner the new
// password": an admin starts a RESET. They choose nothing and see nothing;
// the owner gets a one-time link and picks their own password. The email
// says who started it, when and from where, and carries a "this wasn't me"
// button that ends every session and locks the account until the owner
// resets. Allowed only when the owner switched it on (default off), and
// recorded in admin_audit_log (who, on whom, when).
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { APP_URL } from '@/lib/brand';
import {
  generateRecoveryLink, hashToken, newRawToken, notMeExpiry, notifyOwnerResetInitiated, recordSecurityEvent, requestOrigin,
  serviceAdmin, userEmail,
} from '@/lib/account-security-server';

export async function POST(req: Request) {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not available in this workspace.' }, { status: 200 });
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { targetUserId } = await req.json().catch(() => ({})) as { targetUserId?: string };
  if (!targetUserId) return NextResponse.json({ ok: false, error: 'targetUserId is required.' }, { status: 400 });
  if (targetUserId === user.id) return NextResponse.json({ ok: false, error: 'Reset your own password from the Password section.' }, { status: 400 });

  const { data: self } = await admin.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!self) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (self.role !== 'admin') return NextResponse.json({ ok: false, error: 'Only an admin can start an owner reset.' }, { status: 403 });

  const { data: target } = await admin.from('org_members').select('user_id, role, allow_admin_password_reset')
    .eq('org_id', self.org_id).eq('user_id', targetUserId).maybeSingle();
  if (!target || target.role !== 'owner') return NextResponse.json({ ok: false, error: 'That user is not an owner of your org.' }, { status: 404 });
  if (!target.allow_admin_password_reset) return NextResponse.json({ ok: false, error: 'This owner has not allowed admins to start a reset.' }, { status: 403 });

  const ownerEmail = await userEmail(admin, targetUserId);
  if (!ownerEmail) return NextResponse.json({ ok: false, error: 'Owner email not found.' }, { status: 500 });
  const { data: org } = await admin.from('orgs').select('name').eq('id', self.org_id).maybeSingle();

  const resetLink = await generateRecoveryLink(admin, ownerEmail);
  if (!resetLink) return NextResponse.json({ ok: false, error: 'Could not create the reset link.' }, { status: 502 });

  const now = new Date();
  const { ip, userAgent } = requestOrigin(req);
  const raw = newRawToken();
  const eventId = await recordSecurityEvent(admin, {
    userId: targetUserId, orgId: self.org_id, kind: 'owner_reset_initiated', actorUserId: user.id, ip, userAgent,
    tokenHash: hashToken(raw), tokenExpiresAt: notMeExpiry(now), detail: { adminEmail: user.email },
  });
  const notMeLink = `${APP_URL}/api/account/not-me?token=${raw}`;

  const mail = await notifyOwnerResetInitiated({
    ownerEmail, orgId: self.org_id, orgName: org?.name ?? 'your company', adminEmail: user.email, when: now, ip, userAgent, resetLink, notMeLink,
  });

  await admin.from('admin_audit_log').insert({
    admin_user_id: user.id, action: 'owner_password_reset_initiated', subject_type: 'user', subject_id: targetUserId,
    detail: { orgId: self.org_id, orgName: org?.name ?? null, adminEmail: user.email, ownerEmail, ip, userAgent, eventId, emailSent: mail.sent },
  });

  // The link itself is never returned to the admin's browser.
  return NextResponse.json({ ok: true, emailSent: mail.sent });
}
