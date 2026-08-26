// Prompt 319 — My Network 4/9, founder side. GET (no params): every
// follow-on signal this org has ever received (Pedido C.3, real identity —
// visibility only masks what OTHER investors see, never what the founder
// sees about their own relationship). GET ?entityId=X: the single-entity
// widget entities/[id] uses for the "Ask about follow-on interest" button.
// POST: send that ask.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { getFollowOnStatusForOrg, requestFollowOnAsk, findInvestedDelivery } from '@/lib/network-followon-db';

async function orgAndAdmin(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (!(await networkAvailable())) return { error: NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' }) };

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Founders only.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { admin, orgId: member.org_id as string };
}

export async function GET(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (entityId) {
    const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).eq('entity_id', entityId).maybeSingle();
    if (!delivery) return NextResponse.json({ eligible: false });
    // Prompt 396 §1 — this used to stop at "a delivery row exists", which is
    // true for ANY investor who came through MatchDeal, invested or not.
    // The POST (requestFollowOnAsk) already requires a verified invested
    // relationship (findInvestedDelivery) — this GET now checks the same
    // thing, so the button only ever renders where the ask can actually go
    // through.
    const found = await findInvestedDelivery(admin, orgId, delivery.catalog_id);
    if (!found || !found.invested) return NextResponse.json({ eligible: false });
    const all = await getFollowOnStatusForOrg(admin, orgId);
    const mine = all.find((s) => s.investorCatalogEntityId === delivery.catalog_id);
    const { data: openRequest } = await admin.from('network_followon_requests')
      .select('id').eq('org_id', orgId).eq('investor_catalog_entity_id', delivery.catalog_id).is('resolved_at', null).maybeSingle();
    return NextResponse.json({
      eligible: true, investorCatalogEntityId: delivery.catalog_id, signal: mine ?? null, requestPending: !!openRequest,
    });
  }

  const signals = await getFollowOnStatusForOrg(admin, orgId);
  return NextResponse.json({ ok: true, signals });
}

export async function POST(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const body = await req.json().catch(() => ({})) as { investorCatalogEntityId?: string };
  if (!body.investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'Missing investorCatalogEntityId.' }, { status: 400 });

  const result = await requestFollowOnAsk(admin, { orgId, investorCatalogEntityId: body.investorCatalogEntityId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
}
