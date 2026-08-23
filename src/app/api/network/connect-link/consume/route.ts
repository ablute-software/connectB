// Prompt 335 §D3a — consuming someone's personal connect link. Always
// requires an authenticated caller (the unauthenticated case is handled
// entirely client-side: the landing page redirects to /signup first, then
// calls this same endpoint once a session exists). Creates a PENDING
// network_invites row from the link owner to the caller — opening the link
// is not itself a connection, double opt-in still holds, the caller still
// has to accept it like any other invite.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { resolveActorId, findConnectLinkByTokenHash, connectLinkInvitesGeneratedThisWeek, createInvite } from '@/lib/network-db';
import { connectLinkPaused } from '@/lib/network';
import { hashToken } from '@/lib/matchdeal-pairing';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { token?: string };
  if (!body.token) return NextResponse.json({ ok: false, error: 'Missing token.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const opener = await resolveActorId(admin, user.id);
  if (!opener) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const link = await findConnectLinkByTokenHash(admin, hashToken(body.token));
  if (!link || link.revoked) return NextResponse.json({ ok: false, error: 'This link is no longer active.' }, { status: 404 });
  if (link.actorId === opener.actorId) return NextResponse.json({ ok: false, error: 'This is your own link.' }, { status: 400 });

  const generatedThisWeek = await connectLinkInvitesGeneratedThisWeek(admin, link.actorId);
  if (connectLinkPaused(generatedThisWeek)) {
    return NextResponse.json({ ok: false, error: 'This link has reached its weekly limit — ask them to share it again later.' });
  }

  const result = await createInvite(admin, {
    fromActorId: link.actorId, toActorId: opener.actorId, contextKind: 'connect_link',
    message: 'Invited you to connect via their personal connect link.',
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
