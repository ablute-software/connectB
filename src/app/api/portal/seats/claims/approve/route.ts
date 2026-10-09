// Prompt 904 decision 3 — the firm's administrator accepts someone who claimed the profile with the
// firm's email domain. Takes a seat within the plan's number; past it, refuses and says why.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { approvePendingSeatClaim } from '@/lib/investor-seat-claims';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { claimId?: string };
  if (!body.claimId) return NextResponse.json({ ok: false, error: 'Missing claimId.' }, { status: 400 });
  const result = await approvePendingSeatClaim(admin, { entityId: ctx.entityId, claimId: body.claimId, actorUserId: ctx.userId });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
