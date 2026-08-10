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
//
// Prompt 149 — the RPC itself (migration 0053) never validates the target
// either: it only checks the ACTOR's plan_tier/weekly quota, then accepts
// any existing p_target_profile_id of any kind. Two real effects, found on
// independent review of 7add5c8: (1) a tier_b user can boost a profile
// that never appeared on their own deck, forcing a "you got a super like"
// notification on someone who's never seen them; (2) when actor/target
// kind aren't opposite, the matchdeal_boosts insert is skipped (its own
// `if v_actor.kind = 'investor' and v_target.kind = 'startup'` guard), but
// the function's LAST line — `perform matchdeal_record_swipe(actor,
// target, 'like')` — has no such guard and runs unconditionally, recording
// a real 'like' for a same-kind pairing that should never have been
// possible. Both are closed here, before the RPC (and its quota spend) is
// ever reached: target must (a) be the opposite kind from the actor, and
// (b) have actually been exposed to this actor (matchdeal_exposures).
// Fixed at the route, not inside 0053 itself — this is the only real call
// site today, and any other service_role caller inherits the same gap;
// flagged for a possible follow-up hardening the RPC directly, not done
// here (see this prompt's own note on that trade-off).
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

  const { data: target } = await admin.from('matchdeal_profiles').select('kind').eq('id', body.targetProfileId).maybeSingle();
  const expectedTargetKind = body.kind === 'startup' ? 'investor' : 'startup';
  if (!target || target.kind !== expectedTargetKind) {
    return NextResponse.json({ ok: false, error: 'MATCHDEAL_TARGET_WRONG_KIND' }, { status: 400 });
  }

  const { data: exposure } = await admin.from('matchdeal_exposures').select('id')
    .eq('viewer_profile_id', actorProfileId).eq('shown_profile_id', body.targetProfileId).limit(1).maybeSingle();
  if (!exposure) return NextResponse.json({ ok: false, error: 'MATCHDEAL_TARGET_NOT_SHOWN' }, { status: 400 });

  const { error } = await admin.rpc('matchdeal_activate_super_like', {
    p_actor_profile_id: actorProfileId, p_target_profile_id: body.targetProfileId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
