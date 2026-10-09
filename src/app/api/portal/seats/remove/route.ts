// Prompt 904 Part C — the firm's administrator takes a member's seat away. The membership becomes
// inactive; the person's own account is untouched and the firm's data stays with the firm.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { removeSeat } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { memberId?: string };
  if (!body.memberId) return NextResponse.json({ ok: false, error: 'Missing memberId.' }, { status: 400 });
  const result = await removeSeat(makeSeatStore(admin), {
    entityId: ctx.entityId, memberId: body.memberId, actor: ctx.userId, actorMemberId: ctx.memberId,
  });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
