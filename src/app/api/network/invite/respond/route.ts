// Prompt 316 — My Network 1/9. Accept/decline a received invite. Accepting
// creates the network_connections row (network-db.ts's respondToInvite);
// declining just closes the invite — silence and a decline read identically
// to the SENDER (never a visible rejection, per the prompt's own "silêncio
// = expira, nunca vira rejeição visível"), the distinction only matters
// server-side for bookkeeping.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, respondToInvite } from '@/lib/network-db';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { inviteId?: string; action?: 'accept' | 'decline' };
  if (!body.inviteId || (body.action !== 'accept' && body.action !== 'decline')) {
    return NextResponse.json({ ok: false, error: 'Missing inviteId or action.' }, { status: 400 });
  }

  const result = await respondToInvite(admin, body.inviteId, actor.actorId, body.action);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
