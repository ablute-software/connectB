// Prompt 360 §A2 — curation, item by item: "Accept" turns a Sherlock
// research item into a real company_claims row (category mercado_timing,
// sourceKind 'web_research', sourceRef the source URL) — so it feeds
// mini-pitch/Blueprint/the gap-interrogation engine without any new wiring,
// same reuse-not-reinvent reasoning as document-extraction-linking.ts's own
// proposeClaimFromDocumentFact. "Reject" just marks it rejected —
// unique(org_id, section, title) then keeps it from ever being re-proposed
// under the same research signature.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketResearchItemsAvailable } from '@/lib/market-data-capability';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { normalizeAtom } from '@/lib/company-claims';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await marketResearchItemsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const body = await req.json().catch(() => ({})) as { id?: string; action?: 'accept' | 'reject' };
  if (!body.id || (body.action !== 'accept' && body.action !== 'reject')) {
    return NextResponse.json({ ok: false, error: 'id and action are required.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: item } = await admin.from('market_research_items')
    .select('id, title, detail, source_url').eq('id', body.id).eq('org_id', orgId).eq('status', 'pending').maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: 'Item not found.' }, { status: 404 });

  if (body.action === 'reject') {
    const { error } = await admin.from('market_research_items').update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  let claimId: string | null = null;
  if (await claimsAvailable()) {
    const statement = `${item.title}. ${item.detail}`.trim();
    const n = normalizeAtom({ category: 'mercado_timing', statement, sourceKind: 'web_research', sourceRef: item.source_url ?? undefined });
    const { data: claim, error: claimError } = await admin.from('company_claims').insert({
      org_id: orgId, category: n.category, statement: n.statement,
      evidence_class: n.evidenceClass, specificity: n.specificity,
      source_kind: n.sourceKind, source_ref: n.sourceRef ?? null, status: 'accepted',
    }).select('id').single();
    if (claimError) return NextResponse.json({ ok: false, error: claimError.message }, { status: 500 });
    claimId = (claim?.id as string | undefined) ?? null;
  }

  const { error } = await admin.from('market_research_items')
    .update({ status: 'accepted', created_claim_id: claimId, updated_at: new Date().toISOString() })
    .eq('id', body.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, claimId });
}
