// Prompt 904 Part C — the seats of the caller's firm. Any member learns whether the firm has a custom
// plan; only an administrator gets the member list, reserved seats and the numbers to manage them.
import { NextResponse } from 'next/server';
import { authSeatCaller } from '@/lib/investor-firm-seats-guard';
import { seatSummary, tierSeatLimitInfo } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

export async function GET() {
  const auth = await authSeatCaller();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  if (!ctx.plan) return NextResponse.json({ ok: true, hasPlan: false });
  if (!ctx.isAdmin) {
    return NextResponse.json({ ok: true, hasPlan: true, isAdmin: false, planName: ctx.plan.planName, seats: ctx.plan.seats });
  }
  const summary = await seatSummary(makeSeatStore(admin), ctx.entityId, tierSeatLimitInfo('pro_scout', 'Pro Scout'));
  return NextResponse.json({
    ok: true, hasPlan: true, isAdmin: true, ownMemberId: ctx.memberId,
    planName: summary.planName, seats: summary.limit, used: summary.used, reserved: summary.reserved, free: summary.free,
    members: summary.members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, since: m.since })),
    invites: summary.invites.map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt })),
  });
}
