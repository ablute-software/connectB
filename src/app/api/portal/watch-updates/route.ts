// Prompt 348 §D — the investor's own side of watch_updates: only updates
// actually addressed to them (target='all' while they're an active
// watcher, or target='selected' naming their catalog entity id).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { findWatch } from '@/lib/investor-watching-db';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ updates: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ updates: [] });
  const watch = await findWatch(admin, orgId, investorCatalogEntityId);
  if (!watch || watch.status !== 'active') return NextResponse.json({ updates: [] });

  const { data } = await admin.from('watch_updates').select('id, body, target, recipient_investor_catalog_entity_ids, created_at')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  const mine = (data ?? []).filter((u) =>
    u.target === 'all' || (u.recipient_investor_catalog_entity_ids ?? []).includes(investorCatalogEntityId));
  return NextResponse.json({ updates: mine.map((u) => ({ id: u.id, body: u.body, createdAt: u.created_at })) });
}
