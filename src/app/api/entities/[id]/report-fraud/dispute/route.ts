// Prompt 285 §2 — founder-facing "This may be a mistake", the recourse
// after a report (or someone else's report of the same entity) leaves the
// entity resolved_blocked with no self-service undo (by design, see
// entity_fraud_flags's own header — "só a revisão da plataforma decide").
// This never touches entities.hard_filter_status itself: it only marks the
// relevant flag disputed and re-arms status='pending' so it resurfaces in
// the backoffice queue for a human to actually decide, same auth pattern
// as report-fraud/route.ts (session + explicit org_members check).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { entityFraudDisputeAvailable } from '@/lib/entity-fraud-dispute-capability';
import { crossOrgFraudBlockSourceAvailable } from '@/lib/cross-org-fraud-capability';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (!(await entityFraudDisputeAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: entity, error: entityErr } = await admin.from('entities')
    .select('id, org_id, hard_filter_status').eq('id', id).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });
  if (entity.hard_filter_status !== 'resolved_blocked') {
    return NextResponse.json({ ok: false, error: 'This entity has no pending fraud report to dispute.' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { reason?: string; evidence?: string };
  const reason = body.reason?.trim();
  if (!reason) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });
  const evidence = body.evidence?.trim();
  const disputeReason = evidence ? `${reason}\n\nAdditional evidence: ${evidence}` : reason;

  // Prompt 285 §2 — the flag a dispute attaches to: the most recent one for
  // this entity still 'pending' (never reviewed yet) OR already 'actioned'
  // with outcome='confirmed' (reviewed, agreed — this is the one a founder
  // would actually want reconsidered; a 'dismissed' flag already released
  // the entity back to 'open', so hard_filter_status wouldn't be
  // resolved_blocked in that case at all).
  let flag: { id: string } | null = null;
  {
    const { data, error: flagErr } = await admin.from('entity_fraud_flags')
      .select('id, status, outcome')
      .eq('entity_id', id)
      .or('status.eq.pending,and(status.eq.actioned,outcome.eq.confirmed)')
      .order('flagged_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
    flag = data;
  }

  // Prompt 285 §3 — a platform_action block (cross-org threshold) has no
  // flag on THIS org's own entity_id — this org never reported anything;
  // the flags live on the reporting orgs' own entity_id, all sharing this
  // entity's catalog_id. Fall back to the most recently confirmed flag for
  // that same catalog_id so the dispute still reaches a human, attached to
  // the case it actually concerns.
  if (!flag && (await crossOrgFraudBlockSourceAvailable())) {
    const { data: entityWithSource } = await admin.from('entities').select('hard_filter_block_source').eq('id', id).maybeSingle();
    if (entityWithSource?.hard_filter_block_source === 'platform_action') {
      const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', id).maybeSingle();
      if (delivery?.catalog_id) {
        const { data, error: catalogFlagErr } = await admin.from('entity_fraud_flags')
          .select('id, status, outcome')
          .eq('catalog_id', delivery.catalog_id)
          .eq('status', 'actioned').eq('outcome', 'confirmed')
          .order('flagged_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (catalogFlagErr) return NextResponse.json({ ok: false, error: catalogFlagErr.message }, { status: 500 });
        flag = data;
      }
    }
  }
  if (!flag) return NextResponse.json({ ok: false, error: 'No matching fraud report found for this entity.' }, { status: 404 });

  const { error: updateErr } = await admin.from('entity_fraud_flags').update({
    dispute_reason: disputeReason, disputed_at: new Date().toISOString(), disputed_by: user.id,
    // Re-arms review regardless of the flag's prior status — an already-
    // actioned/confirmed flag needs to resurface in the backoffice queue's
    // pending list for the dispute to actually reach a human; a still-
    // pending flag is a no-op status-wise (already 'pending').
    status: 'pending',
  }).eq('id', flag.id);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
