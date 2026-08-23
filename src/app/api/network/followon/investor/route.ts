// Prompt 319 — My Network 4/9, investor side. GET: every startup this
// investor holds a verified invested relationship with, each flagged with
// whether a follow-on signal is already active, plus any open "ask" from a
// startup. POST: signal (create/renew), change visibility, or revoke — the
// investor is always the only one who can write here (Pedido A: "só o
// investidor pode CRIAR/revogar").
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import {
  getInvestedRelationshipsForInvestor, getOpenFollowOnRequestsForInvestor,
  setFollowOnSignal, updateFollowOnVisibility, revokeFollowOnSignal, dismissFollowOnRequest,
} from '@/lib/network-followon-db';

async function investorAndAdmin(req: Request) {
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
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return { error: NextResponse.json({ ok: false, error: 'Investors only.' }, { status: 403 }) };
  return { admin, investorCatalogEntityId };
}

export async function GET(req: Request) {
  const resolved = await investorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, investorCatalogEntityId } = resolved;

  const [relationships, requests] = await Promise.all([
    getInvestedRelationshipsForInvestor(admin, investorCatalogEntityId),
    getOpenFollowOnRequestsForInvestor(admin, investorCatalogEntityId),
  ]);
  return NextResponse.json({ ok: true, relationships, requests });
}

export async function POST(req: Request) {
  const resolved = await investorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, investorCatalogEntityId } = resolved;

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; action?: 'signal' | 'change_visibility' | 'revoke' | 'dismiss_request'; visibility?: 'named' | 'anonymous';
  };
  if (!body.orgId || !body.action) return NextResponse.json({ ok: false, error: 'Missing orgId or action.' }, { status: 400 });

  if (body.action === 'signal') {
    if (body.visibility !== 'named' && body.visibility !== 'anonymous') return NextResponse.json({ ok: false, error: 'Missing visibility.' }, { status: 400 });
    const result = await setFollowOnSignal(admin, { orgId: body.orgId, investorCatalogEntityId, visibility: body.visibility });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'change_visibility') {
    if (body.visibility !== 'named' && body.visibility !== 'anonymous') return NextResponse.json({ ok: false, error: 'Missing visibility.' }, { status: 400 });
    const result = await updateFollowOnVisibility(admin, { orgId: body.orgId, investorCatalogEntityId, visibility: body.visibility });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'revoke') {
    const result = await revokeFollowOnSignal(admin, { orgId: body.orgId, investorCatalogEntityId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'dismiss_request') {
    await dismissFollowOnRequest(admin, { orgId: body.orgId, investorCatalogEntityId });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
