// Prompt 904 Part C — the seats of the caller's firm. Any member learns whether the firm has a custom
// plan; only an administrator gets the member list, reserved seats and the numbers to manage them.
import { NextResponse } from 'next/server';
import { authSeatCaller } from '@/lib/investor-firm-seats-guard';
import { seatSummary, tierSeatLimitInfo } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { listPendingSeatClaims } from '@/lib/investor-seat-claims';
import { inviteDisplay } from '@/lib/seat-invite-accept';
import type { SupabaseClient } from '@supabase/supabase-js';

// No request argument, so Next would prerender this at build time and freeze whatever it answered then.
export const dynamic = 'force-dynamic';

async function recentAccepted(admin: SupabaseClient, entityId: string) {
  const { data } = await admin.from('investor_firm_seat_invites').select('id, email, accepted_at').eq('catalog_entity_id', entityId).eq('status', 'accepted').order('accepted_at', { ascending: false }).limit(20);
  return ((data ?? []) as { id: string; email: string; accepted_at: string | null }[]).map((r) => ({ id: r.id, email: r.email, acceptedAt: r.accepted_at, ...inviteDisplay({ status: 'accepted', failureReason: null }) }));
}

export async function GET() {
  const auth = await authSeatCaller();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  if (!ctx.plan) return NextResponse.json({ ok: true, hasPlan: false });
  if (!ctx.isAdmin) {
    return NextResponse.json({ ok: true, hasPlan: true, isAdmin: false, planName: ctx.plan.planName, seats: ctx.plan.seats });
  }
  const summary = await seatSummary(makeSeatStore(admin), ctx.entityId, tierSeatLimitInfo('pro_scout', 'Pro Scout'));
  const pendingClaims = await listPendingSeatClaims(admin, ctx.entityId);
  return NextResponse.json({
    ok: true, hasPlan: true, isAdmin: true, ownMemberId: ctx.memberId,
    planName: summary.planName, seats: summary.limit, used: summary.used, reserved: summary.reserved, free: summary.free,
    members: summary.members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, since: m.since })),
    // Prompt 923 (B.3): Open, or "Couldn't be accepted" with the reason (the invitation stays open); the accepted ones are listed below (recent first).
    invites: summary.invites.map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt, ...inviteDisplay({ status: 'open', failureReason: i.failureReason ?? null }) })),
    acceptedInvites: await recentAccepted(admin, ctx.entityId),
    // Domain-matched claimants waiting for THIS firm's administrator to accept or decline.
    pendingClaims: pendingClaims.map((c) => ({ id: c.id, email: c.claimantEmail, createdAt: c.createdAt })),
  });
}
