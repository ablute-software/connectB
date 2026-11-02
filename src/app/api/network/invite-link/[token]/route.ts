// Prompt 335 §D1 — public lookup backing the /network/invite/[token]
// landing page. No auth: the recipient hasn't signed up yet. The raw token
// (32 random bytes) is the entire authorization, same trust model as
// MatchDeal's own pairing tokens.
import { NextResponse } from 'next/server';
import { createNoStoreClient } from '@/lib/supabase-no-store';
import { findEmailInviteByTokenHash, resolveActorDisplays } from '@/lib/network-db';
import { hashToken } from '@/lib/matchdeal-pairing';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  // This route reads no cookie and no header, so a bare client would let Next's fetch cache answer: a revoked or accepted invite would keep resolving as pending.
  const admin = createNoStoreClient(url, serviceKey, { auth: { persistSession: false } });
  const invite = await findEmailInviteByTokenHash(admin, hashToken(params.token));
  if (!invite) return NextResponse.json({ ok: false, error: 'This link is not valid.' }, { status: 404 });
  if (new Date(invite.expiresAt) <= new Date()) return NextResponse.json({ ok: false, error: 'This invite link has expired.' }, { status: 404 });

  const displays = await resolveActorDisplays(admin, [invite.fromActorId]);
  const inviter = displays.get(invite.fromActorId);
  return NextResponse.json({ ok: true, inviterName: inviter?.name ?? 'Someone', message: invite.message, status: invite.status });
}
