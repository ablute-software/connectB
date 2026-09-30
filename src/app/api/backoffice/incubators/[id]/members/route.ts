// Prompt I-01 §C.1 — add an owner/manager by e-mail: an `invited`
// incubator_members row (token stored as its sha256 only) + the member
// invite e-mail. The person accepts at /invite/incubator/member/<token> with
// the account of that same address. Never an org_members/access_grants row.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';
import { APP_URL } from '@/lib/brand';
import { incubatorMemberInvitePath, looksLikeEmail, normalizeInviteEmail } from '@/lib/incubators';
import { memberInviteEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as { email?: string; role?: string; fullName?: string };
  const email = normalizeInviteEmail(body.email ?? '');
  if (!looksLikeEmail(email)) return NextResponse.json({ ok: false, error: 'Invalid email.' }, { status: 400 });
  const role = body.role === 'owner' ? 'owner' : 'manager';

  const { data: inc } = await admin.from('incubators').select('id, name, closed_at').eq('id', params.id).maybeSingle();
  if (!inc || inc.closed_at) return NextResponse.json({ ok: false, error: 'Organisation not found or closed.' }, { status: 404 });

  const token = generateRawToken();
  const expires = new Date(Date.now() + 14 * 86400000).toISOString();
  const { data: pending } = await admin.from('incubator_members').select('id')
    .eq('incubator_id', inc.id).eq('status', 'invited').eq('invited_email', email).maybeSingle();
  const write = { role, full_name: body.fullName?.trim() || null, invite_token_hash: hashToken(token), invite_expires_at: expires, invited_by: userId };
  const { data: member, error } = pending
    ? await admin.from('incubator_members').update(write).eq('id', pending.id).select('id').single()
    : await admin.from('incubator_members').insert({ incubator_id: inc.id, invited_email: email, status: 'invited', ...write }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const sent = await sendIncubatorEmail(email,
    memberInviteEmail({ incubatorName: inc.name, role, url: `${APP_URL}${incubatorMemberInvitePath(token)}` }),
    { kind: 'incubator_member_invite' });
  await logAdminAction(admin, { adminUserId: userId, action: 'incubator_member_invited', subjectType: 'incubator', subjectId: inc.id, detail: { email, role, member_id: member.id, sent: sent.sent } });
  return NextResponse.json({ ok: true, memberId: member.id, emailSent: sent.sent, emailError: sent.sent ? null : sent.error ?? null });
}
