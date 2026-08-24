// Prompt 358 Phase 2.1 — the founder's side of a medium-confidence
// reconciliation match: the engine already found a plausible document, this
// is the one-click "yes, that's it" or "no, that's not it" — never the
// founder having to go find the document themselves from scratch (that's
// still available via /api/blueprint/link-document's own picker). Confirm
// links the document via the SAME atomic RPC every other linking path in
// this codebase uses; dismiss marks the match 'dismissed', which
// reconciliation.ts then treats as sticky — never re-suggesting the same
// rejected match again, same non-reopening discipline as gap_disposition.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { gapReconciliationsAvailable } from '@/lib/document-extraction-capability';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await claimsAvailable()) || !(await gapReconciliationsAvailable())) {
    return NextResponse.json({ ok: false, error: 'not configured' });
  }

  const body = await req.json().catch(() => ({})) as { claimId?: string; confirm?: boolean };
  if (!body.claimId || typeof body.confirm !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'claimId and confirm are required.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: reconciliation } = await admin.from('gap_reconciliations')
    .select('matched_document_id').eq('claim_id', body.claimId).eq('org_id', orgId).eq('status', 'suggested').maybeSingle();
  if (!reconciliation?.matched_document_id) return NextResponse.json({ ok: false, error: 'No suggestion to confirm.' }, { status: 404 });

  if (!body.confirm) {
    const { error } = await admin.from('gap_reconciliations').update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('claim_id', body.claimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: doc } = await admin.from('documents').select('id, name').eq('id', reconciliation.matched_document_id).eq('org_id', orgId).maybeSingle();
  if (!doc) return NextResponse.json({ ok: false, error: 'Suggested document no longer exists.' }, { status: 404 });

  const { error: linkError } = await admin.rpc('link_claim_document_ref', {
    p_claim_id: body.claimId, p_ref: { documentId: doc.id, documentName: doc.name, page: null },
  });
  if (linkError) return NextResponse.json({ ok: false, error: linkError.message }, { status: 500 });

  const { error } = await admin.from('gap_reconciliations').update({ status: 'auto_linked', updated_at: new Date().toISOString() })
    .eq('claim_id', body.claimId).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
