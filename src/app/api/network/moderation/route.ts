// Prompt 531 — the reported startup's own view of moderation against it,
// and the "Contest decision" submission.
//
// THIS ROUTE IS THE PRIVACY BOUNDARY (§34, §§39-44). It is the only
// startup-accessible surface that touches moderation data, and everything it
// returns is built by toStartupStrikeView (network-moderation.ts), which is
// an allowlist constructor rather than a filter over a database row —
// support_tickets is never queried here at all, so the reporter's identity,
// their category, their free text and the number of reports have no path
// into this response, including through a nested object someone forgets to
// re-check. The unit tests assert the serialized JSON, not just the keys.
//
// Scoping is by the caller's OWN actor id, resolved server-side from their
// session (resolveActorId) — never from a body parameter — so one startup
// cannot read another's moderation history by guessing an id.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { readStrikesForActor, submitAppeal } from '@/lib/network-moderation-db';
import { networkModerationAvailable } from '@/lib/network-moderation-capability';
import { strikeConsequenceLine } from '@/lib/network-moderation';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable()) || !(await networkModerationAvailable())) return NextResponse.json({ available: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ available: false });

  const { strikes, activeStrikeCount, banned } = await readStrikesForActor(admin, actor.actorId);
  return NextResponse.json({
    available: true,
    strikes,
    activeStrikeCount,
    banned,
    consequence: strikeConsequenceLine(activeStrikeCount, banned),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable()) || !(await networkModerationAvailable())) {
    return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { strikeId?: string; body?: string };
  if (!body.strikeId) return NextResponse.json({ ok: false, error: 'Missing strikeId.' }, { status: 400 });

  // submitAppeal re-checks that the strike belongs to THIS actor and
  // returns the same "Strike not found" for someone else's id as for a
  // nonexistent one — a guessed id must not be distinguishable from a wrong
  // one, or the ids become an enumeration oracle.
  const result = await submitAppeal(admin, {
    strikeId: body.strikeId, actorId: actor.actorId, body: body.body ?? '',
  });
  return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error }, { status: result.ok ? 200 : 400 });
}
