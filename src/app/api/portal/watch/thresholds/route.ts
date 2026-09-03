// Prompt 348 §C — the investor's own mechanical alert menu for one watch.
// Never free text: WATCH_THRESHOLD_KINDS is the entire vocabulary.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { findWatch } from '@/lib/investor-watching-db';
import { WATCH_THRESHOLD_KINDS } from '@/lib/investor-watching';
import { assertNotViewer } from '@/lib/developer-viewer';

async function resolveWatchId(admin: SupabaseClient, userId: string, orgId: string) {
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  if (!investorCatalogEntityId) return null;
  const watch = await findWatch(admin, orgId, investorCatalogEntityId);
  return watch && watch.status === 'active' ? watch.id : null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ thresholds: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const watchId = await resolveWatchId(admin, user.id, orgId);
  if (!watchId) return NextResponse.json({ thresholds: [] });

  const { data } = await admin.from('investor_watch_thresholds').select('kind, threshold_value').eq('watch_id', watchId);
  return NextResponse.json({ thresholds: data ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; kind?: string; thresholdValue?: number; enabled?: boolean };
  if (!body.orgId || !body.kind || !WATCH_THRESHOLD_KINDS.includes(body.kind as never)) {
    return NextResponse.json({ ok: false, error: 'orgId and a valid kind are required.' }, { status: 400 });
  }
  if (body.kind === 'match_score_above' && typeof body.thresholdValue !== 'number') {
    return NextResponse.json({ ok: false, error: 'thresholdValue is required for match_score_above.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const watchId = await resolveWatchId(admin, user.id, body.orgId);
  if (!watchId) return NextResponse.json({ ok: false, error: 'No active watch found.' }, { status: 404 });

  if (body.enabled === false) {
    await admin.from('investor_watch_thresholds').delete().eq('watch_id', watchId).eq('kind', body.kind);
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.from('investor_watch_thresholds').upsert({
    watch_id: watchId, kind: body.kind, threshold_value: body.thresholdValue ?? null,
  }, { onConflict: 'watch_id,kind' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
