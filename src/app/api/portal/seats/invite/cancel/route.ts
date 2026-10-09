// Prompt 904 Part C — give a reserved seat back before anyone used it.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { cancelSeatInvite } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { inviteId?: string };
  if (!body.inviteId) return NextResponse.json({ ok: false, error: 'Missing inviteId.' }, { status: 400 });
  const result = await cancelSeatInvite(makeSeatStore(admin), { entityId: ctx.entityId, inviteId: body.inviteId, actor: ctx.userId });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
