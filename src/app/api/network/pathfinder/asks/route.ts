// Prompt 320 — My Network 5/9. The connection's own side of a Pathfinder
// ask: "X asked you to refer them to Y". GET lists open asks; POST
// dismisses one (composing the actual referral goes through the existing
// /api/network/referral route, pre-filled by the /network page itself).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { getOpenPathfinderAsksForConnection, dismissPathfinderAsk } from '@/lib/network-pathfinder-db';

async function actorAndAdmin(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (!(await networkAvailable())) return { error: NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return { error: NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 }) };
  return { admin, actorId: actor.actorId };
}

export async function GET(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const asks = await getOpenPathfinderAsksForConnection(resolved.admin, resolved.actorId);
  return NextResponse.json({ ok: true, asks });
}

export async function POST(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400 });
  await dismissPathfinderAsk(resolved.admin, { id: body.id, connectionActorId: resolved.actorId });
  return NextResponse.json({ ok: true });
}
