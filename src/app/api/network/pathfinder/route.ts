// Prompt 320 — My Network 5/9. GET ?entityId=X: PathfinderCard's own data —
// which of the founder's connections has a verified invested relationship
// with the investor behind this entity. POST: "ask {connection} for an
// intro" (Pedido B) — notifies the connection, never composes on their
// behalf.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { networkAvailable } from '@/lib/network-capability';
import { resolveInvestorForEntity, getPathfinderMatches, createPathfinderAsk, getPathfinderEntityIdsWithMatch } from '@/lib/network-pathfinder-db';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

async function orgAndAdmin(req: Request): Promise<{ error: NextResponse } | { admin: SupabaseClient; orgId: string; myActorId: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (!(await networkAvailable())) return { error: NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' }) };

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return { error: NextResponse.json({ ok: false, error: 'Founders only.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: actor } = await admin.from('network_actors').select('id').eq('org_id', acting.orgId).maybeSingle();
  if (!actor) return { error: NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 }) };
  return { admin, orgId: acting.orgId as string, myActorId: actor.id as string };
}

export const GET = withActingOrg(async function GET(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId, myActorId } = resolved;

  const searchParams = new URL(req.url).searchParams;
  if (searchParams.get('summary') === '1') {
    const entityIds = await getPathfinderEntityIdsWithMatch(admin, { myActorId, myOrgId: orgId });
    return NextResponse.json({ ok: true, entityIds: [...entityIds] });
  }

  const entityId = searchParams.get('entityId');
  if (!entityId) return NextResponse.json({ ok: false, error: 'Missing entityId.' }, { status: 400 });

  const investor = await resolveInvestorForEntity(admin, orgId, entityId);
  if (!investor) return NextResponse.json({ ok: true, applicable: false, matches: [] });

  const matches = await getPathfinderMatches(admin, {
    myActorId, myOrgId: orgId, investorCatalogEntityId: investor.investorCatalogEntityId, investorActorId: investor.investorActorId,
  });
  return NextResponse.json({ ok: true, applicable: true, investorName: investor.investorName, investorActorId: investor.investorActorId, matches });
});

export const POST = withActingOrg(async function POST(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, myActorId } = resolved;

  const body = await req.json().catch(() => ({})) as { connectionActorId?: string; targetActorId?: string };
  if (!body.connectionActorId || !body.targetActorId) return NextResponse.json({ ok: false, error: 'Missing connectionActorId or targetActorId.' }, { status: 400 });

  const result = await createPathfinderAsk(admin, { requesterActorId: myActorId, connectionActorId: body.connectionActorId, targetActorId: body.targetActorId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true });
});
