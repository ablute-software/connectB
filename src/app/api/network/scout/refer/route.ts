// Prompt 323 Pedido B — refer a startup through an open scout request.
// Literally an instance of 318's referral flow (referrer=founder,
// referred=the startup they know, target=the requesting investor), just
// entered from a scout request instead of a shared-investor context, and
// under a different eligibility rule (network.ts's canReferViaScoutRequest —
// no invested relationship required, the request itself is the invitation).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { createReferralViaScoutRequest } from '@/lib/network-reciprocity-db';

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

  const body = await req.json().catch(() => ({})) as { scoutRequestId?: string; referredActorId?: string; message?: string };
  if (!body.scoutRequestId || !body.referredActorId || !body.message?.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing scoutRequestId, referredActorId, or message.' }, { status: 400 });
  }

  const result = await createReferralViaScoutRequest(admin, {
    scoutRequestId: body.scoutRequestId, referrerActorId: actor.actorId, referredActorId: body.referredActorId, message: body.message,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
