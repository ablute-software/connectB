// Prompt 323 — My Network 8/9, office hours. GET: offers visible to the
// caller (self + active connections). POST: create one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { createOffer, readOffersForActor } from '@/lib/network-reciprocity-db';
import type { NetworkOfferKind } from '@/lib/network';

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
  const offers = await readOffersForActor(resolved.admin, resolved.actorId);
  return NextResponse.json({ ok: true, offers });
}

export async function POST(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId } = resolved;

  const body = await req.json().catch(() => ({})) as { kind?: NetworkOfferKind; description?: string; slotsTotal?: number; expiresAt?: string };
  if (!body.kind || !body.description || !body.slotsTotal || !body.expiresAt) {
    return NextResponse.json({ ok: false, error: 'Missing kind, description, slotsTotal, or expiresAt.' }, { status: 400 });
  }

  const result = await createOffer(admin, { actorId, kind: body.kind, description: body.description, slotsTotal: body.slotsTotal, expiresAt: body.expiresAt });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, offerId: result.offerId });
}
