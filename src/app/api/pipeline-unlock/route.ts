// Prompt 123 Block B.2 — real-data wiring for the pipeline-unlock engine.
// The actual formula-input gathering + calculation lives in
// pipeline-unlock-server.ts (shared with the Backoffice Startups table,
// Block C.1, so both surfaces read the exact same number). This route's own
// job is just the one write side-effect: an idempotent, system-derived
// profile_completed_at stamp the first time the B.2 gate passes — guarded
// by assertNotViewer so a developer viewing a startup read-only never
// triggers it.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer, readVerifiedViewerOrgId } from '@/lib/developer-viewer';
import { isProfileGateComplete, missingProfileGateFields } from '@/lib/pipeline-unlock';
import { computeDeliverable, computeVisiblePipelineSize, raiseCatalogQuotaFloor } from '@/lib/pipeline-unlock-server';
import { pipelineUnlockAnchorsAvailable } from '@/lib/pipeline-unlock-capability';

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Developer Viewer reads the viewed org, same override store-supabase.tsx
  // already applies for the rest of the workspace.
  // Prompt 559 §A — this read takes priority over the membership lookup
  // below, so it has to be the verified one: an unverified cookie here
  // pointed `select('*')` on orgs, and the profile_completed_at write, at
  // any org id the caller could name.
  let orgId = await readVerifiedViewerOrgId(sb, req);
  if (!orgId) {
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    orgId = member?.org_id ?? null;
  }
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  // Prompt 536 §1 — read once and keep the row: `missing` (which of the nine
  // gate fields are still empty) is what the Pipeline shows instead of a
  // percentage from calcCompanyCompleteness. The founder is told the thing
  // they can act on, and it is the SAME predicate that decides whether the
  // unlock may run — the two can no longer say different things.
  const { data: org } = await admin.from('orgs').select('*').eq('id', orgId).maybeSingle();
  const missing = org ? missingProfileGateFields(org) : [];

  const anchorsAvailable = await pipelineUnlockAnchorsAvailable();
  if (anchorsAvailable) {
    if (org && isProfileGateComplete(org) && !org.profile_completed_at) {
      const viewerBlock = await assertNotViewer(sb, req);
      if (!viewerBlock) await admin.from('orgs').update({ profile_completed_at: new Date().toISOString() }).eq('id', orgId);
    }
  }

  const { visible, gateComplete, eligiblePoolSize, catalogQuotaTarget } = await computeVisiblePipelineSize(admin, orgId);
  // Prompt 180 — the live recompute trigger for orgs.catalog_quota's
  // event-based floor (see raiseCatalogQuotaFloor's own header): this route
  // is already polled by the founder-facing Pipeline page every time
  // entities change, which is exactly the same "did an input to the formula
  // just change" moment the badge above reacts to. No-ops cheaply when
  // gateComplete is false (catalogQuotaTarget is 0) or the target isn't
  // higher than what's already stored.
  await raiseCatalogQuotaFloor(admin, orgId, catalogQuotaTarget);

  // Prompt 536 §3 — how many investors the founder could unlock RIGHT NOW,
  // computed after the floor has been raised so the number reflects what
  // they have already earned rather than what was stored before this page
  // load. This is the same arithmetic /api/pipeline-unlock/deliver runs, via
  // the same RPC on the same session, so the button's "Unlock N more" and
  // the number actually delivered cannot disagree — the previous design's
  // whole failure mode was two surfaces computing the same thing differently.
  // Zero for a Developer Viewer: catalog_effective_quota()'s is_org_member()
  // is evaluated against the developer, not the viewed org, and this route
  // is read-only for them anyway.
  //
  // Prompt 579 — "cannot disagree" above was true of the arithmetic but not
  // of what it could produce: an is_ablute_developer() account reads quota
  // as the 999999 sentinel (migration 0166), and quota - delivered handed
  // that straight to the screen as "999989 more". computeDeliverable caps it
  // at the real catalog supply left for this org and reports `unlimited`
  // instead of ever letting the sentinel itself out as a number.
  let deliverable = 0;
  let unlimited = false;
  if (gateComplete) {
    const [{ data: quotaData }, { count: deliveredCount }] = await Promise.all([
      sb.rpc('catalog_effective_quota', { check_org: orgId }),
      admin.from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('quota_exempt', false),
    ]);
    const quota = typeof quotaData === 'number' ? quotaData : 0;
    ({ deliverable, unlimited } = await computeDeliverable(admin, orgId, quota, deliveredCount ?? 0));
  }

  return NextResponse.json({ ok: true, gateComplete, visible, eligiblePoolSize, catalogQuotaTarget, deliverable, unlimited, missing, anchorsAvailable });
}
