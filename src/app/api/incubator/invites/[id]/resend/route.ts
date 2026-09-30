// Prompt I-01 §A.8 — resend: a NEW token (the old link dies), 30 more days,
// send_count + 1 — all inside incubator_resend_invite(); this route mints the
// raw token and only ever hands the database its hash.
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';
import { APP_URL } from '@/lib/brand';
import { incubatorErrorText, incubatorInvitePath } from '@/lib/incubators';
import { startupInviteEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { sb, member } = gate;

  const token = generateRawToken();
  const { data, error } = await sb.rpc('incubator_resend_invite', { p_invite_id: params.id, p_new_token_hash: hashToken(token) });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });

  const { data: inv } = await sb.from('incubator_invites').select('email, startup_name').eq('id', params.id).maybeSingle();
  const sent = await sendIncubatorEmail(data.email as string, startupInviteEmail({
    incubatorName: member.incubatorName, startupName: inv?.startup_name ?? null,
    url: `${APP_URL}${incubatorInvitePath(token)}`, voucher: null,
  }), { kind: 'incubator_invite' });
  return NextResponse.json({ ok: true, emailSent: sent.sent, emailError: sent.sent ? null : sent.error ?? null });
}
