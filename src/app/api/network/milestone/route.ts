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
import { readRoundMilestoneDraft } from '@/lib/network-posts-db';

// Prompt 528 — GET now also returns the DRAFT TEXT, and the POST that used to
// publish on a single click is gone entirely. The button opens the ordinary
// composer pre-filled with this text; publishing goes through the same
// createPost every other post uses, so an edited milestone is linted by
// checkNetworkContent like anything else.
//
// GET still decides whether to SHOW the button at all — absence, not a
// disabled-but-visible state, per this app's own established discipline
// (round_progress_visible_to_investors's own header comment). It now also
// says no when there is no progress worth announcing (see
// readRoundMilestoneDraft).
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

  const draft = await readRoundMilestoneDraft(admin, member.org_id as string);
  return draft.available
    ? NextResponse.json({ ok: true, available: true, text: draft.text })
    : NextResponse.json({ ok: true, available: false, reason: draft.reason });
}
