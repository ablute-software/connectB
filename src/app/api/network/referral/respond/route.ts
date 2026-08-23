// Prompt 318 — My Network 3/9. Two distinct decisions on the SAME referral,
// made by two different actors at two different stages — kept in one route
// (as: 'referred' | 'target') rather than two files, since both bodies are
// otherwise identical and the underlying adapter functions already enforce
// which stage/actor each is valid for.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { respondAsReferred, respondAsTarget } from '@/lib/network-referrals-db';

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

  const body = await req.json().catch(() => ({})) as { referralId?: string; as?: 'referred' | 'target'; action?: 'accept' | 'decline' };
  if (!body.referralId || (body.as !== 'referred' && body.as !== 'target') || (body.action !== 'accept' && body.action !== 'decline')) {
    return NextResponse.json({ ok: false, error: 'Missing referralId, as, or action.' }, { status: 400 });
  }

  if (body.as === 'referred') {
    if (!actor.orgId) return NextResponse.json({ ok: false, error: 'Only a founder can consent on behalf of their own company.' }, { status: 403 });
    const result = await respondAsReferred(admin, body.referralId, actor.orgId, body.action);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
    return NextResponse.json({ ok: true });
  }

  const result = await respondAsTarget(admin, body.referralId, actor.actorId, body.action);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
