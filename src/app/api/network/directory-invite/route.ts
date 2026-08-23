// Prompt 335 §D2 — "Invite to connect" from a directory search result.
// Target is always a network_discoverable founder org (never an arbitrary
// email/actor), resolved server-side from orgId — the client never gets to
// pick an actorId directly, only an orgId it saw in its own search results.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, findActorIdByOrgId, countPendingInvitesFrom, createInvite } from '@/lib/network-db';
import { canSendInvite } from '@/lib/network';

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

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'Missing orgId.' }, { status: 400 });
  const { data: org } = await admin.from('orgs').select('network_discoverable').eq('id', body.orgId).maybeSingle();
  if (!org?.network_discoverable) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const toActorId = await findActorIdByOrgId(admin, body.orgId);
  if (!toActorId || toActorId === actor.actorId) return NextResponse.json({ ok: false, error: 'Could not resolve that account.' }, { status: 400 });

  const pendingCount = await countPendingInvitesFrom(admin, actor.actorId);
  if (!canSendInvite(pendingCount)) {
    return NextResponse.json({ ok: false, error: 'You already have 5 pending invites out — wait for one to be answered before sending another.' });
  }

  const result = await createInvite(admin, {
    fromActorId: actor.actorId, toActorId, contextKind: 'directory', message: 'Found you via the Sherlock Deal directory.',
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
