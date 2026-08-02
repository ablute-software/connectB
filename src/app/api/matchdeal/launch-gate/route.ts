// Prompt 92 — MatchDeal launch gate. Pre-launch (September 2026), the only
// accounts with a working MatchDeal are @ablute.pt (dev/test) — everyone
// else gets the "launches soon" message at every entry point, never the
// deck itself (which today only has fictional demo profiles to show).
// Server-side, not a client-only email-string check: this is the one thing
// standing between a real account and seeing MatchDeal's dev-only content
// before it's ready, so it goes through the same auth session the rest of
// the app trusts, not a value read straight off the client.
import { NextResponse } from 'next/server';
import { serverClient, isAbluteTeamEmail } from '@/lib/supabase-server';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  return NextResponse.json({ ok: true, allowed: isAbluteTeamEmail(user?.email) });
}
