// Prompt 531 — Back-office → Startups → Strikes.
//
// GET             the list (one row per actor with strikes and/or a My
//                 Network ban), or ?actorId=… for that actor's full strike
//                 history including appeals.
// POST            the four reversal/appeal actions.
//
// Platform admin only, through the same requirePlatformAdmin gate every
// other /api/backoffice/* route uses — the moderation actions here are
// exactly the ones §33 says must not be reachable by founders or investors,
// and the gate is server-side, not a hidden button.
//
// No new audit system: every mutation below records itself in
// admin_audit_log via network-moderation-db.ts, with previous and resulting
// state, and never deletes the record it supersedes.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import {
  decideAppeal, readStrikeDetail, readStrikeList, readStrikesForActor, reverseStrike, setActorBan,
} from '@/lib/network-moderation-db';
import { notifyAppealDecided } from '@/lib/network-moderation-notify';
import { networkModerationAvailable } from '@/lib/network-moderation-capability';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await networkModerationAvailable())) {
    return NextResponse.json({ ok: true, available: false, rows: [] });
  }

  const actorId = new URL(req.url).searchParams.get('actorId');
  if (actorId) {
    const strikes = await readStrikeDetail(admin, actorId);
    return NextResponse.json({ ok: true, available: true, strikes });
  }
  return NextResponse.json({ ok: true, available: true, rows: await readStrikeList(admin) });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  if (!(await networkModerationAvailable())) {
    return NextResponse.json({ ok: false, error: 'Activates once migration 0291 is applied.' }, { status: 200 });
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string; strikeId?: string; actorId?: string; appealId?: string;
    outcome?: 'upheld' | 'reversed'; reason?: string; note?: string;
  };

  if (body.action === 'reverse_strike') {
    if (!body.strikeId) return NextResponse.json({ ok: false, error: 'Missing strikeId.' }, { status: 400 });
    const result = await reverseStrike(admin, { strikeId: body.strikeId, adminUserId: userId, reason: body.reason });
    return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error }, { status: result.ok ? 200 : 400 });
  }

  // Ban and strike reversal are separate calls on purpose (§15): reversing a
  // strike below the threshold does not lift an existing suspension, and a
  // moderator lifting a suspension is not implicitly clearing strikes.
  if (body.action === 'lift_ban' || body.action === 'apply_ban') {
    if (!body.actorId) return NextResponse.json({ ok: false, error: 'Missing actorId.' }, { status: 400 });
    const result = await setActorBan(admin, {
      actorId: body.actorId, banned: body.action === 'apply_ban', adminUserId: userId, reason: body.reason,
    });
    return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error }, { status: result.ok ? 200 : 400 });
  }

  if (body.action === 'decide_appeal') {
    if (!body.appealId || (body.outcome !== 'upheld' && body.outcome !== 'reversed')) {
      return NextResponse.json({ ok: false, error: 'Missing appealId or outcome.' }, { status: 400 });
    }
    const result = await decideAppeal(admin, {
      appealId: body.appealId, outcome: body.outcome, adminUserId: userId, note: body.note,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

    // Tell the startup the outcome — decision only. The internal decision
    // note stays in the back-office (§28), and the notifier is never handed
    // the report, so there is nothing reporter-shaped for it to include.
    const { data: appeal } = await admin.from('network_strike_appeals')
      .select('actor_id, strike_id').eq('id', body.appealId).maybeSingle();
    if (appeal?.actor_id) {
      const actorId = appeal.actor_id as string;
      const { strikes, activeStrikeCount, banned } = await readStrikesForActor(admin, actorId);
      const struck = strikes.find((s) => s.strikeId === appeal.strike_id);
      await notifyAppealDecided(admin, {
        actorId, outcome: body.outcome, snapshot: struck?.content ?? null, activeStrikeCount, banned,
      });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
