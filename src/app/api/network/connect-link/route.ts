// Prompt 335 §D3a — "My connect link": one permanent, revocable/regenerable
// link per actor. GET returns status (never the raw token — that's only
// ever handed back once, at generation, same as MatchDeal's own pairing
// tokens). POST regenerates (action: 'regenerate') or revokes (action:
// 'revoke').
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { resolveActorId, connectLinkStatus, upsertConnectLink, revokeConnectLink } from '@/lib/network-db';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';

async function requireActor(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return { error: NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 }) };
  return { admin, actorId: actor.actorId };
}

export async function GET(req: Request) {
  const r = await requireActor(req);
  if ('error' in r) return r.error;
  const status = await connectLinkStatus(r.admin, r.actorId);
  return NextResponse.json({ ok: true, status });
}

export async function POST(req: Request) {
  const r = await requireActor(req);
  if ('error' in r) return r.error;
  const body = await req.json().catch(() => ({})) as { action?: 'regenerate' | 'revoke' };

  if (body.action === 'revoke') {
    await revokeConnectLink(r.admin, r.actorId);
    return NextResponse.json({ ok: true });
  }

  const rawToken = generateRawToken();
  await upsertConnectLink(r.admin, r.actorId, hashToken(rawToken));
  const origin = new URL(req.url).origin;
  return NextResponse.json({ ok: true, link: `${origin}/network/connect/${rawToken}` });
}
