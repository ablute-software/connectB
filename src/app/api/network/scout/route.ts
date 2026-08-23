// Prompt 323 — My Network 8/9, reverse scout. GET: open requests visible to
// the caller (self + investor's active connections — never platform-wide).
// POST: create one (investor only). PATCH: close one's own request.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { createScoutRequest, readScoutRequestsForActor, closeScoutRequest, countReferralsForScoutRequest } from '@/lib/network-reciprocity-db';

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
  return { admin, actorId: actor.actorId, kind: actor.kind };
}

export async function GET(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId } = resolved;
  const requests = await readScoutRequestsForActor(admin, actorId);
  const withCounts = await Promise.all(requests.map(async (r) => ({
    ...r, receivedReferrals: r.investorActorId === actorId ? await countReferralsForScoutRequest(admin, r.id) : null,
  })));
  return NextResponse.json({ ok: true, requests: withCounts });
}

export async function POST(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId, kind } = resolved;
  if (kind !== 'investor') return NextResponse.json({ ok: false, error: 'Investors only.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { sectors?: string[]; stage?: string; geography?: string; description?: string; expiresAt?: string };
  if (!body.description || !body.expiresAt) return NextResponse.json({ ok: false, error: 'Missing description or expiresAt.' }, { status: 400 });

  const result = await createScoutRequest(admin, {
    investorActorId: actorId, sectors: body.sectors ?? [], stage: body.stage, geography: body.geography,
    description: body.description, expiresAt: body.expiresAt,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, requestId: result.requestId });
}

export async function PATCH(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actorId } = resolved;

  const body = await req.json().catch(() => ({})) as { requestId?: string };
  if (!body.requestId) return NextResponse.json({ ok: false, error: 'Missing requestId.' }, { status: 400 });

  const result = await closeScoutRequest(admin, { requestId: body.requestId, investorActorId: actorId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
