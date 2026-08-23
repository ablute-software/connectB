// Prompt 335 §D3b — cohort codes. Self-service join, additive to the
// existing owner-initiated invite flow for groups (migration 0211,
// untouched). No founder-facing UI to CREATE a code in this prompt —
// codes are set directly on network_groups.join_code by backoffice/
// developer for now (documented gap, per the prompt's own scope).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, joinGroupByCode } from '@/lib/network-db';

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

  const body = await req.json().catch(() => ({})) as { code?: string };
  if (!body.code?.trim()) return NextResponse.json({ ok: false, error: 'Missing code.' }, { status: 400 });

  const result = await joinGroupByCode(admin, actor.actorId, body.code);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, groupId: result.groupId, groupName: result.groupName });
}
