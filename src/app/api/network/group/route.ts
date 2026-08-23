// Prompt 317 — My Network 2/9. GET with no query: every group the caller
// owns or actively belongs to. GET ?groupId=X: one group's detail (members
// resolved to display names) — 404s (as an honest "not found", never a 403
// leak) for a group the caller isn't in. POST: create a group, whose
// initial member list is validated with the exact same eligibility rule an
// addition-after-creation uses (network.ts's canAddGroupMember).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, resolveActorDisplays, readGroupsForActor, readGroupDetail, createGroup } from '@/lib/network-db';
import type { NetworkGroupKind } from '@/lib/types';

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { available: false };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json(empty);

  const groupId = req.nextUrl.searchParams.get('groupId');
  if (groupId) {
    const detail = await readGroupDetail(admin, groupId, actor.actorId);
    if (!detail) return NextResponse.json({ available: true, group: null });
    const displays = await resolveActorDisplays(admin, detail.members.map((m) => m.actorId));
    return NextResponse.json({
      available: true,
      group: {
        id: detail.group.id, name: detail.group.name, description: detail.group.description, kind: detail.group.kind,
        isOwner: detail.isOwner, ownerActorId: detail.group.ownerActorId,
        members: detail.members.map((m) => ({
          actorId: m.actorId, status: m.status, name: displays.get(m.actorId)?.name ?? 'Unknown', kind: displays.get(m.actorId)?.kind ?? 'founder',
        })),
      },
    });
  }

  const groups = await readGroupsForActor(admin, actor.actorId);
  return NextResponse.json({
    available: true,
    groups: groups.map((g) => ({ id: g.group.id, name: g.group.name, description: g.group.description, kind: g.group.kind, memberCount: g.memberCount, isOwner: g.group.ownerActorId === actor.actorId })),
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
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string; kind?: NetworkGroupKind; initialMemberActorIds?: string[];
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ ok: false, error: 'A group name is required.' }, { status: 400 });
  if (body.kind !== 'accelerator_batch' && body.kind !== 'investor_portfolio' && body.kind !== 'topic') {
    return NextResponse.json({ ok: false, error: 'Invalid group kind.' }, { status: 400 });
  }

  const result = await createGroup(admin, {
    ownerActorId: actor.actorId, ownerIsInvestor: actor.kind === 'investor', name,
    description: body.description?.trim() || null, kind: body.kind, initialMemberActorIds: body.initialMemberActorIds ?? [],
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, groupId: result.group.id, invited: result.invited });
}
