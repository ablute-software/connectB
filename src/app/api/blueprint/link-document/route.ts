// Prompt 358 Phase 1 — G4's "Yes — I will attach it" is an intent, not a
// fact: the real answer is the document itself. This links an EXISTING
// Vault document to the claim the gap was about, via the same atomic
// link_claim_document_ref RPC document-extraction-linking.ts already uses
// (migration 0208) — never a text claim reading "Yes — I will attach it".
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable, blueprintAnalysesAvailable } from '@/lib/blueprint-capability';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await claimsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const body = await req.json().catch(() => ({})) as {
    claimId?: string; documentId?: string; gapKey?: string; analysisId?: string;
  };
  if (!body.claimId || !body.documentId) return NextResponse.json({ ok: false, error: 'claimId and documentId are required.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Confirms both rows actually belong to this org before linking anything
  // — same "resolve, then check ownership before writing" discipline as
  // every other cross-table write in this app.
  const [{ data: claim }, { data: doc }] = await Promise.all([
    admin.from('company_claims').select('id').eq('id', body.claimId).eq('org_id', orgId).maybeSingle(),
    admin.from('documents').select('id, name').eq('id', body.documentId).eq('org_id', orgId).maybeSingle(),
  ]);
  if (!claim) return NextResponse.json({ ok: false, error: 'Claim not found.' }, { status: 404 });
  if (!doc) return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });

  const { error } = await admin.rpc('link_claim_document_ref', {
    p_claim_id: body.claimId,
    p_ref: { documentId: doc.id, documentName: doc.name, page: null },
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Same interrogation ledger entry a normal answer writes — this gap WAS
  // answered, just via a document link instead of text.
  if (body.analysisId && await blueprintAnalysesAvailable()) {
    const { data: current } = await admin.from('blueprint_analyses')
      .select('questions_asked').eq('id', body.analysisId).eq('org_id', orgId).maybeSingle();
    const asked = Array.isArray(current?.questions_asked) ? current.questions_asked as unknown[] : [];
    await admin.from('blueprint_analyses').update({
      questions_asked: [...asked, { key: body.gapKey, rule: 'G4', answered: true, dismissed: false, attachedDocumentId: doc.id, at: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
    }).eq('id', body.analysisId).eq('org_id', orgId);
  }

  return NextResponse.json({ ok: true });
}
