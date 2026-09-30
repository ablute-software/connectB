// Prompt I-01 §C.3 — "Convidar startup". Inserts the invite through the
// member's own session (RLS incubator_invites_insert: member, status
// 'invited', no voucher yet, invited_by = the caller's own member row), then
// sends the e-mail with the raw token — which exists only in that e-mail and
// in this request; the database keeps its sha256.
//
// The voucher field: no promo code belongs to an incubator before I-02, so
// any voucher sent here is refused rather than silently attached — the
// global promo codes are never offered under an incubator's name.
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';
import { APP_URL } from '@/lib/brand';
import { incubatorInvitePath, looksLikeEmail, normalizeInviteEmail } from '@/lib/incubators';
import { startupInviteEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

export async function POST(req: Request) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { sb, member } = gate;

  const body = await req.json().catch(() => ({})) as {
    email?: string; startupName?: string; sector?: string; website?: string; cohortId?: string | null; note?: string; promoCodeId?: string | null;
  };
  const email = normalizeInviteEmail(body.email ?? '');
  if (!looksLikeEmail(email)) return NextResponse.json({ ok: false, error: 'E-mail inválido.' }, { status: 400 });
  if (body.promoCodeId) {
    return NextResponse.json({ ok: false, error: 'Sem vouchers disponíveis — os protocolos chegam no I-02.' }, { status: 400 });
  }

  const token = generateRawToken();
  const now = new Date().toISOString();
  const { data: invite, error } = await sb.from('incubator_invites').insert({
    incubator_id: member.incubatorId,
    cohort_id: body.cohortId || null,
    email,
    startup_name: body.startupName?.trim() || null,
    sector: body.sector?.trim() || null,
    website: body.website?.trim() || null,
    note: body.note?.trim() || null,
    invited_by: member.id,
    token_hash: hashToken(token),
  }).select('id').single();
  if (error) {
    const msg = error.code === '23505' ? 'Já existe um convite pendente para este e-mail.' : error.message;
    return NextResponse.json({ ok: false, error: msg }, { status: error.code === '23505' ? 409 : 500 });
  }

  const sent = await sendIncubatorEmail(email, startupInviteEmail({
    incubatorName: member.incubatorName, startupName: body.startupName?.trim() || null,
    url: `${APP_URL}${incubatorInvitePath(token)}`, voucher: null,
  }), { kind: 'incubator_invite' });
  if (sent.sent) {
    await sb.from('incubator_invites').update({ sent_at: now, last_sent_at: now, send_count: 1 }).eq('id', invite.id);
  }
  return NextResponse.json({ ok: true, inviteId: invite.id, emailSent: sent.sent, emailError: sent.sent ? null : sent.error ?? null });
}
