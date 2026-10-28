// Prompt 923 (B) — "Send the link again": the invitation's email, once more, to the address it was made for. For an invitation that is still open (an invitation that was sent before invitations had a link of their own is
// given one by the migration, so this also brings it to the new page). Only a firm administrator, only an invitation of THIS firm; recorded in the seat history.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { sendSeatInviteEmail } from '@/lib/seat-invites-store';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { inviteId?: string };
  if (!body.inviteId) return NextResponse.json({ ok: false, error: 'Missing inviteId.' }, { status: 400 });
  const { data } = await admin.from('investor_firm_seat_invites').select('email, token').eq('id', body.inviteId).eq('catalog_entity_id', ctx.entityId).eq('status', 'open').maybeSingle();
  const row = data as { email?: string; token?: string } | null;
  if (!row?.email || !row.token) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const emailSent = await sendSeatInviteEmail(admin, { entityId: ctx.entityId, email: row.email, token: row.token });
  await makeSeatStore(admin).recordEvent(ctx.entityId, 'invite_resent', ctx.userId, { inviteId: body.inviteId, emailSent });
  return NextResponse.json({ ok: true, emailSent });
}
