// Prompt 322 Pedido C — "Share a round milestone with your network". Gated
// entirely server-side on orgs.round_progress_visible_to_investors (the
// SAME toggle 212 §A already built, never a second one) — the button on
// the client only decides whether to SHOW itself off the same flag, this
// route is the actual enforcement.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { createRoundMilestonePost } from '@/lib/network-posts-db';

// GET tells the client whether to even SHOW the button — absence, not a
// disabled-but-visible state, per this app's own established discipline
// (round_progress_visible_to_investors's own header comment).
export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, available: false });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, available: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: true, available: false });

  const { data: org } = await admin.from('orgs').select('round_progress_visible_to_investors').eq('id', member.org_id).maybeSingle();
  return NextResponse.json({ ok: true, available: !!org?.round_progress_visible_to_investors });
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
  if (!actor || !actor.orgId) return NextResponse.json({ ok: false, error: 'Founders only.' }, { status: 403 });

  const result = await createRoundMilestonePost(admin, { authorActorId: actor.actorId, orgId: actor.orgId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, postId: result.postId });
}
