// Prompt 138 D2 — on-demand enrichment when an entity enters a founder's
// pipeline. Called (fire-and-forget) from unlockPack() right after it
// writes catalog_deliveries, with the catalog_ids that were just delivered.
//
// enrichment_jobs RLS (0146) is admin-only for every command, including
// insert — a normal founder session cannot write this table directly, so
// this has to go through a service-role route (the option the prompt
// itself recommended over opening an insert-only RLS exception). This only
// enqueues: it never invokes the worker, never spends money.
//
// Defense in depth: the client supplies which catalog_ids it just
// delivered, but this route re-verifies each one actually has a
// catalog_deliveries row for this org before enqueuing — a caller can't
// queue enrichment for an entity it doesn't have in its own pipeline.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as { catalogIds?: unknown };
  const requested = Array.isArray(body.catalogIds) ? body.catalogIds.filter((x): x is string => typeof x === 'string') : [];
  if (requested.length === 0) return NextResponse.json({ ok: true, enqueued: 0 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Only catalog_ids this org actually has delivered — never trust the
  // client's list at face value.
  const { data: deliveries } = await admin.from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).in('catalog_id', requested);
  const deliveredIds = [...new Set((deliveries ?? []).map((d) => d.catalog_id as string))];
  if (deliveredIds.length === 0) return NextResponse.json({ ok: true, enqueued: 0 });

  const { data: catalogRows } = await admin
    .from('catalog_entities')
    .select('id, enrichment_status, enrichment_stale_after')
    .in('id', deliveredIds);

  const now = new Date();
  const due = (catalogRows ?? []).filter((c) => {
    if (c.enrichment_status === 'pending') return true;
    return !!c.enrichment_stale_after && new Date(c.enrichment_stale_after as string) < now;
  });

  let enqueued = 0;
  for (const c of due) {
    // No ON CONFLICT DO NOTHING here on purpose: enrichment_jobs_one_active_per_target
    // is a PARTIAL unique index (status in queued/running), and PostgREST's
    // upsert can't express that predicate as a conflict target. Check first,
    // and still treat a 23505 from the insert itself as "already queued" —
    // belt and suspenders against the race between the check and the insert.
    const { data: active } = await admin
      .from('enrichment_jobs')
      .select('id')
      .eq('target_type', 'entity')
      .eq('target_id', c.id)
      .eq('layer', 1)
      .in('status', ['queued', 'running'])
      .maybeSingle();
    if (active) continue;

    const { error } = await admin.from('enrichment_jobs').insert({
      target_type: 'entity', target_id: c.id, layer: 1, priority: 150, requested_by_org_id: orgId,
    });
    if (!error) enqueued++;
    else if (error.code !== '23505') console.error('[enqueue-enrichment] insert failed', c.id, error.message);
  }

  return NextResponse.json({ ok: true, enqueued });
}
