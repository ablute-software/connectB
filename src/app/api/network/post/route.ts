// Prompt 321 — My Network 6/9. GET: the feed. POST: publish. DELETE:
// soft-delete (author only).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { createPost, deletePost, readFeedForActor } from '@/lib/network-posts-db';

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
  const posts = await readFeedForActor(resolved.admin, resolved.actorId);
  return NextResponse.json({ ok: true, posts });
}

export async function POST(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId } = resolved;

  const body = await req.json().catch(() => ({})) as { body?: string; target?: 'all' | 'group'; groupId?: string; excludedActorIds?: string[] };
  if (!body.body?.trim() || (body.target !== 'all' && body.target !== 'group')) {
    return NextResponse.json({ ok: false, error: 'Missing body or target.' }, { status: 400 });
  }

  const result = await createPost(admin, {
    authorActorId: actorId, body: body.body, target: body.target, groupId: body.groupId, excludedActorIds: body.excludedActorIds,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, postId: result.postId });
}

export async function DELETE(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId } = resolved;

  const postId = new URL(req.url).searchParams.get('postId');
  if (!postId) return NextResponse.json({ ok: false, error: 'Missing postId.' }, { status: 400 });

  const result = await deletePost(admin, { postId, authorActorId: actorId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
