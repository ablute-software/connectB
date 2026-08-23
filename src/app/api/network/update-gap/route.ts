// Prompt 322 Pedido B — the private cadence coach. Founder-only, always
// about the caller's OWN last update — this must never resolve or expose
// another actor's posting history, that's exactly the public-cadence
// comparison the prompt's own correction forbids.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { readLastUpdatePostCreatedAt } from '@/lib/network-posts-db';
import { lastUpdateGapCheck } from '@/lib/network';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, shouldNudge: false });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, shouldNudge: false });
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, shouldNudge: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor || actor.kind !== 'founder') return NextResponse.json({ ok: true, shouldNudge: false });

  const lastUpdateAt = await readLastUpdatePostCreatedAt(admin, actor.actorId);
  const result = lastUpdateGapCheck(lastUpdateAt, new Date());
  return NextResponse.json({ ok: true, ...result });
}
