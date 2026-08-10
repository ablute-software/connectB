// Prompt 148 §1 — matchdeal_activate_super_like is service_role-only since
// migration 0136 (no EXECUTE for authenticated, confirmed live:
// has_function_privilege('authenticated', ..., 'EXECUTE') = false). Every
// tap on "Boost" was failing with a Postgres permission error, not the
// weekly-limit UX MatchDealDeck.tsx already handled — Prompt 143 wired the
// client straight to the RPC and never caught this. This route is the
// fix: same shape as /api/portal/scorecard/*, resolve the caller's own
// profile from their session, then call the RPC with service-role creds.
//
// migration 0136's own guard on matchdeal_activate_super_like SKIPS the
// "actor owns this profile" check entirely for a service_role caller (that
// escape hatch exists because the RPC's own body ends by calling
// matchdeal_record_swipe as service_role, which carries no user JWT) — so
// unlike record_swipe/record_exposure (safe to call with a client-supplied
// actor id, since THEIR guard enforces ownership), this route is the ONLY
// thing standing between "boost as anyone" and reality. p_actor_profile_id
// is therefore resolved here from the session, never taken from the
// request body — only p_target_profile_id (which card to boost, not a
// sensitive value) comes from the client.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveOwnMatchdealProfileId } from '@/lib/matchdeal-pairing';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => null) as { kind?: 'startup' | 'investor'; targetProfileId?: string } | null;
  if (!body?.kind || (body.kind !== 'startup' && body.kind !== 'investor') || !body.targetProfileId) {
    return NextResponse.json({ ok: false, error: 'Missing kind or targetProfileId.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const actorProfileId = await resolveOwnMatchdealProfileId(admin, user.id, body.kind);
  if (!actorProfileId) return NextResponse.json({ ok: false, error: 'No MatchDeal profile for this account.' }, { status: 403 });

  const { error } = await admin.rpc('matchdeal_activate_super_like', {
    p_actor_profile_id: actorProfileId, p_target_profile_id: body.targetProfileId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
