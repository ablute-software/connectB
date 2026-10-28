// Prompt 904 Part C — the firm's administrator reserves a seat for an email. Blocked, with the reason,
// when the plan's seats are all taken or reserved. Never says whether the email has an account.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { inviteToSeat } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { sendSeatInviteEmail } from '@/lib/seat-invites-store';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { email?: string };

  const result = await inviteToSeat(makeSeatStore(admin), { entityId: ctx.entityId, email: body.email ?? '', actor: ctx.userId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  // Best-effort: the seat is reserved whether or not the email goes out. Prompt 923 (B): the email carries the invitation's OWN link (/invite/seat/<token>), which opens an investor registration tied to it — it used to
  // point to /login and tell the person to claim the profile, which opened the FOUNDER registration for somebody new (28/10/2026).
  const email = (body.email ?? '').trim().toLowerCase();
  const { data: row } = await admin.from('investor_firm_seat_invites').select('token').eq('catalog_entity_id', ctx.entityId).eq('email', email).eq('status', 'open').maybeSingle();
  const token = (row as { token?: string } | null)?.token;
  const emailSent = token ? await sendSeatInviteEmail(admin, { entityId: ctx.entityId, email, token }) : false;
  return NextResponse.json({ ok: true, emailSent });
}
