// Prompt 373 §F — the founder's group-by-group publish toggle. Persisted as
// one jsonb array (orgs.market_groups_visible_to_investors, migration
// 0246) — see that migration's own comment for why one column beats six.
// Closed by default; this route is the ONLY way the array ever changes —
// never touched by the investor side.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketGroupsVisibilityAvailable } from '@/lib/market-data-capability';
import { MARKET_GROUP_KEYS } from '@/lib/market-data-investor-projection';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false, groups: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await marketGroupsVisibilityAvailable())) return NextResponse.json({ available: false, groups: [] });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ available: false, groups: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: org } = await admin.from('orgs').select('market_groups_visible_to_investors').eq('id', orgId).maybeSingle();
  return NextResponse.json({ available: true, groups: (org?.market_groups_visible_to_investors as string[] | null) ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await marketGroupsVisibilityAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { groups?: string[] };
  const groups = (body.groups ?? []).filter((g) => (MARKET_GROUP_KEYS as string[]).includes(g));

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('orgs').update({ market_groups_visible_to_investors: groups }).eq('id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, groups });
}
