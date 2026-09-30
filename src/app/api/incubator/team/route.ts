// Prompt I-01 §C.3 — Equipa: list (incubator_team(), which adds the e-mail
// from auth.users) and add a manager by e-mail (owner only, enforced again
// inside incubator_invite_member()).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';
import { APP_URL } from '@/lib/brand';
import { incubatorErrorText, incubatorMemberInvitePath, looksLikeEmail, normalizeInviteEmail } from '@/lib/incubators';
import { memberInviteEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { data, error } = await gate.sb.rpc('incubator_team', { p_incubator_id: gate.member.incubatorId });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, members: data ?? [], myMemberId: gate.member.id, myRole: gate.member.role });
}

export async function POST(req: Request) {
  const gate = await requireIncubatorMember({ ownerOnly: true });
  if ('error' in gate) return gate.error;
  const { sb, member } = gate;

  const body = await req.json().catch(() => ({})) as { email?: string; fullName?: string; role?: string };
  const email = normalizeInviteEmail(body.email ?? '');
  if (!looksLikeEmail(email)) return NextResponse.json({ ok: false, error: 'E-mail inválido.' }, { status: 400 });
  const role = body.role === 'owner' ? 'owner' : 'manager';

  const token = generateRawToken();
  const { data, error } = await sb.rpc('incubator_invite_member', {
    p_incubator_id: member.incubatorId, p_email: email, p_role: role, p_full_name: body.fullName ?? '', p_token_hash: hashToken(token),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });

  const sent = await sendIncubatorEmail(email,
    memberInviteEmail({ incubatorName: member.incubatorName, role, url: `${APP_URL}${incubatorMemberInvitePath(token)}` }),
    { kind: 'incubator_member_invite' });
  return NextResponse.json({ ok: true, emailSent: sent.sent, emailError: sent.sent ? null : sent.error ?? null });
}
