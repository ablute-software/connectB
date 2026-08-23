// Prompt 323 Pedido A — claim a slot. All atomicity lives in the DB
// function (network_claim_offer_slot); this route resolves identity and
// translates the result. Claiming never creates a connection or shares
// pipeline data — it just registers the match; the actual conversation
// happens via an existing channel (Sherlock messaging, or a direct
// message), never new messaging built here.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { claimOfferSlot } from '@/lib/network-reciprocity-db';

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

  const body = await req.json().catch(() => ({})) as { offerId?: string; note?: string };
  if (!body.offerId) return NextResponse.json({ ok: false, error: 'Missing offerId.' }, { status: 400 });

  const result = await claimOfferSlot(admin, { offerId: body.offerId, claimantActorId: actor.actorId, note: body.note });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
