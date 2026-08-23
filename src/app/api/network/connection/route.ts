// Prompt 316 — My Network 1/9. Remove (revoke) or block a connection.
// Blocking is silent by product decision — the other side is never
// notified — so this route's only observable difference from "remove" is
// what the CALLER'S OWN list shows afterward.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, removeConnection, blockConnection } from '@/lib/network-db';

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

  const body = await req.json().catch(() => ({})) as { connectionId?: string; action?: 'remove' | 'block' };
  if (!body.connectionId || (body.action !== 'remove' && body.action !== 'block')) {
    return NextResponse.json({ ok: false, error: 'Missing connectionId or action.' }, { status: 400 });
  }

  const result = body.action === 'remove'
    ? await removeConnection(admin, body.connectionId, actor.actorId)
    : await blockConnection(admin, body.connectionId, actor.actorId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? 'Could not update this connection.' });
  return NextResponse.json({ ok: true });
}
