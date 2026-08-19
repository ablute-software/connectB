// Prompt 274 — step 1 of "run one entity": idempotently enqueue a Layer 1
// (team-page) enrichment_jobs row for one catalog_entities.id. Fast (a
// couple of indexed reads/writes) — the actual AI/web work happens in a
// SEPARATE call the browser makes directly to the enrichment-worker Edge
// Function (see EnrichmentCampaignPanel.tsx for why: that call can run
// well past Vercel's Hobby-plan function-duration limit, which this route
// must stay under).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { enqueueJob } from '@/lib/enrichment-campaign';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { catalogEntityId } = await req.json().catch(() => ({})) as { catalogEntityId?: string };
  if (!catalogEntityId) return NextResponse.json({ ok: false, error: 'catalogEntityId required' }, { status: 400 });

  const { data: entity, error: entityErr } = await admin.from('catalog_entities')
    .select('enrichment_status, is_test').eq('id', catalogEntityId).maybeSingle();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  if (!entity) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  // Fast no-op rather than an error: a concurrent campaign click, or an
  // earlier run in the same session, may have already enriched this one —
  // the campaign loop just moves on to the next candidate.
  if (entity.is_test || entity.enrichment_status !== 'pending') {
    return NextResponse.json({ ok: true, skip: true, reason: entity.is_test ? 'is_test entity' : `enrichment_status is '${entity.enrichment_status}', not 'pending'` });
  }

  const { jobId, alreadyQueued } = await enqueueJob(admin, 'entity', catalogEntityId, 1);
  await logAdminAction(admin, { adminUserId: userId, action: 'enrichment_campaign_enqueue', subjectType: 'catalog_entity', subjectId: catalogEntityId, detail: { layer: 1, jobId, alreadyQueued } });
  return NextResponse.json({ ok: true, skip: false, jobId, alreadyQueued });
}
