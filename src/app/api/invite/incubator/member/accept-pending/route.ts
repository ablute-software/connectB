// Prompt I-01c §A.2 — accept every pending ecosystem-team invite for the
// signed-in caller's CONFIRMED address (incubator_accept_pending_member_invites()
// under the caller's own session). The safety net for someone who came in
// through the ordinary door instead of the invite link.
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data, error } = await sb.rpc('incubator_accept_pending_member_invites');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, accepted: (data?.accepted as number | undefined) ?? 0 });
}
