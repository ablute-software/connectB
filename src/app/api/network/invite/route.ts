// Prompt 316 — My Network 1/9. Sends an invite. Context is never optional:
// the anti-spam structural rule for this whole feature ("nenhuma ligação
// sem contexto verificável") means every invite must carry a contextRef the
// recipient can actually verify — for this prompt, the shared investor's
// name. The 5-pending cap is enforced twice on purpose: a cheap pre-check
// here for a clear error message, and — the one that actually matters — the
// DB trigger (migration 0209), which is what a race between two requests
// can't get around.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, countPendingInvitesFrom, createInvite } from '@/lib/network-db';
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

  const body = await req.json().catch(() => ({})) as { toActorId?: string; message?: string; contextRef?: string };
  const toActorId = body.toActorId?.trim();
  const message = body.message?.trim();
  if (!toActorId) return NextResponse.json({ ok: false, error: 'Missing toActorId.' }, { status: 400 });
  if (!message) return NextResponse.json({ ok: false, error: 'A short note on why you\'re connecting is required.' }, { status: 400 });
  if (toActorId === actor.actorId) return NextResponse.json({ ok: false, error: 'You can\'t invite yourself.' }, { status: 400 });

  const pendingCount = await countPendingInvitesFrom(admin, actor.actorId);
  if (!canSendInvite(pendingCount)) {
    return NextResponse.json({ ok: false, error: 'You already have 5 pending invites out — wait for one to be answered before sending another.' });
  }

  const result = await createInvite(admin, {
    fromActorId: actor.actorId, toActorId, contextKind: 'shared_investor', contextRef: body.contextRef ?? null, message,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, invite: result.invite });
}
