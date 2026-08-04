// Prompt 97 §2 — the "Approved"/"X" actions on the Matches tab. This has to
// be a server route, not a direct sb.rpc() call from the client like the
// deck's swipe/exposure calls: matchdeal_decide_dataroom_consent(p_match_id,
// p_granted, ...) is SECURITY DEFINER with EXECUTE granted to `authenticated`
// AND `anon`, and — confirmed by reading its live definition — performs NO
// check anywhere that the caller is the startup on p_match_id. Called
// directly from a browser it would let any signed-in (or even anonymous)
// caller grant or decline data-room access for a match that isn't theirs,
// which reaches matchdeal_grant_dataroom() and real access_grants rows. The
// ownership check below is the only thing standing in front of that, so it
// stays here rather than moving inline into a client component.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveOwnMatchdealProfileId } from '@/lib/matchdeal-pairing';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  let body: { matchId?: string; granted?: boolean; declineReason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  const { matchId, granted } = body;
  if (!matchId || typeof granted !== 'boolean') return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Only the startup side of a match decides data-room consent — the RPC's
  // own message text ("A startup autorizou/optou por não partilhar...")
  // confirms this is a startup-only decision, matching Prompt 97 §2.
  const startupProfileId = await resolveOwnMatchdealProfileId(admin, user.id, 'startup');
  if (!startupProfileId) return NextResponse.json({ ok: false, error: 'No startup MatchDeal profile for this account.' }, { status: 403 });

  const { data: match } = await admin.from('matchdeal_matches').select('id, startup_profile_id, status').eq('id', matchId).maybeSingle();
  if (!match) return NextResponse.json({ ok: false, error: 'Match not found.' }, { status: 404 });
  if (match.startup_profile_id !== startupProfileId) return NextResponse.json({ ok: false, error: 'Not your match.' }, { status: 403 });
  if (match.status !== 'pending_consent') return NextResponse.json({ ok: false, error: 'This match already has a decision.' }, { status: 409 });

  const { error } = await admin.rpc('matchdeal_decide_dataroom_consent', {
    p_match_id: matchId, p_granted: granted, p_decline_reason: granted ? null : (body.declineReason ?? null),
  });
  if (error) return NextResponse.json({ ok: false, error: 'Could not record that decision.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
