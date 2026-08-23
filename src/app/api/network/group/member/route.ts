// Prompt 317 — My Network 2/9. Owner-only 'add'/'remove'; any active
// member (including the owner) can 'leave'. 'add' creates a real invite
// (the candidate still has to accept — a group is never force-membership)
// validated by the exact same eligibility rule createGroup uses.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, addGroupMember, removeGroupMember, leaveGroup } from '@/lib/network-db';

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

  const body = await req.json().catch(() => ({})) as { groupId?: string; action?: 'add' | 'remove' | 'leave'; candidateActorId?: string };
  if (!body.groupId || !body.action) return NextResponse.json({ ok: false, error: 'Missing groupId or action.' }, { status: 400 });

  if (body.action === 'leave') {
    const result = await leaveGroup(admin, body.groupId, actor.actorId);
    return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error });
  }

  if (!body.candidateActorId) return NextResponse.json({ ok: false, error: 'Missing candidateActorId.' }, { status: 400 });

  const result = body.action === 'add'
    ? await addGroupMember(admin, { groupId: body.groupId, ownerActorId: actor.actorId, ownerIsInvestor: actor.kind === 'investor', candidateActorId: body.candidateActorId })
    : await removeGroupMember(admin, body.groupId, actor.actorId, body.candidateActorId);
  return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error });
}
