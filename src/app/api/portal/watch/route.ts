// Prompt 348 §A — investor-initiated "Watch this startup" request. Double
// opt-in: this only ever creates a 'requested' row; the founder accepts or
// declines via /api/founder/watches.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { requestWatch, findWatch, markWatchSeen, getSnapshotData, revokeWatch } from '@/lib/investor-watching-db';
import { captureSnapshot, readSnapshotData } from '@/lib/startup-snapshot';
import { computeSnapshotDelta } from '@/lib/investor-watching';
import { assertNotViewer } from '@/lib/developer-viewer';

// The dossier's own "Watch this startup" button state + "what changed"
// summary for ONE org — the single-item counterpart to /api/portal/watchlist
// (which lists every active watch); kept separate rather than reusing that
// route with a filter, since the dossier never needs matchScore/ordering.
export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ status: 'none' });

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
  if (!investorCatalogEntityId) return NextResponse.json({ status: 'none' });

  const watch = await findWatch(admin, orgId, investorCatalogEntityId);
  if (!watch || watch.status === 'declined' || watch.status === 'revoked') return NextResponse.json({ status: 'none' });
  if (watch.status === 'requested') return NextResponse.json({ status: 'requested' });

  const baseline = watch.baseline_snapshot_id ? await getSnapshotData(admin, watch.baseline_snapshot_id) : null;
  const current = await readSnapshotData(admin, orgId);
  const changedFields = baseline ? computeSnapshotDelta(baseline, current) : [];
  const since = watch.last_seen_at ?? watch.requested_at;
  const { data: newClaims } = await admin.from('company_claims').select('statement, evidence_class')
    .eq('org_id', orgId).eq('status', 'accepted').in('evidence_class', [1, 2]).gt('updated_at', since);
  const { data: newRoadmap } = await admin.from('company_roadmap_milestones').select('id').eq('org_id', orgId).gt('updated_at', since);

  return NextResponse.json({
    status: 'active', changedFields,
    newClass1Statements: (newClaims ?? []).filter((c) => c.evidence_class === 1).map((c) => c.statement),
    newClass2Statements: (newClaims ?? []).filter((c) => c.evidence_class === 2).map((c) => c.statement),
    newRoadmapCount: (newRoadmap ?? []).length,
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'This startup is not in your Pipeline.' }, { status: 403 });

  const result = await requestWatch(admin, body.orgId, investorCatalogEntityId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, status: result.watch.status });
}

// Prompt 348 §B — "Marcar como visto actualiza o baseline": recaptures the
// snapshot (so the delta resets to zero going forward) AND stamps
// last_seen_at (the anchor claims/roadmap deltas read forward from).
export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });

  const watch = await findWatch(admin, body.orgId, investorCatalogEntityId);
  if (!watch || watch.status !== 'active') return NextResponse.json({ ok: false, error: 'No active watch found.' }, { status: 404 });

  const { id: snapshotId } = await captureSnapshot(admin, body.orgId, 'manual');
  await admin.from('investor_watches').update({ baseline_snapshot_id: snapshotId }).eq('id', watch.id);
  await markWatchSeen(admin, watch.id);
  return NextResponse.json({ ok: true });
}

// Prompt 352 §B — investor-initiated undo, for both directions: cancel a
// still-pending request (before the founder has responded at all — the row
// is deleted outright, so a since-cancelled request never surfaces on the
// founder's own /api/founder/watches list, same as if it never happened),
// or stop an already-active watch (revoked, same effect the founder's own
// "Stop watching" action already has — confirmed existing via
// /api/founder/watches's POST action='revoke').
export async function DELETE(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });

  const watch = await findWatch(admin, body.orgId, investorCatalogEntityId);
  if (!watch) return NextResponse.json({ ok: false, error: 'No watch found.' }, { status: 404 });

  if (watch.status === 'requested') {
    const { error } = await admin.from('investor_watches').delete().eq('id', watch.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'none' });
  }
  if (watch.status === 'active') {
    const result = await revokeWatch(admin, watch.id, body.orgId, user.id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, status: 'none' });
  }
  return NextResponse.json({ ok: false, error: 'Nothing to cancel.' }, { status: 400 });
}
