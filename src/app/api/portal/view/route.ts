// NEXT_STEPS Phase 4 — log a real investor document view, service-role
// (see access/route.ts note). Surfaces to the founder as "who viewed what."
//
// SECURITY FIX (audited 2026-07-27): viewer_email used to come from the
// request body — spoofable, anyone could log a "view" under any email. Same
// rule as access/route.ts now: the email is always the caller's own verified
// session email, never client input.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: NextRequest) {
  const { documentId } = await req.json();
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  // Prompt 48 — an @ablute.pt QA session (access/route.ts's fallback path)
  // never has a real access_grants row backing it, so a logged "view" here
  // would be a phantom entry with no grant to explain it — and the whole
  // point of the QA path is that it must never look like real investor
  // activity anywhere. Skip the write, not just the display: `ok: true` so
  // the client's fire-and-forget call doesn't surface an error either.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: doc, error: docErr } = await admin.from('documents').select('org_id, folder_id').eq('id', documentId).single();
  if (docErr || !doc) return NextResponse.json({ ok: false, error: docErr?.message ?? 'document not found' }, { status: 404 });

  // Prompt 124 C3 — grant_id was never populated here (confirmed: rows
  // existed in document_views all along, just with grant_id always null),
  // which is why the Organizations tab's "grants confirmed, no
  // document_views on file" action list always fired regardless of real
  // views — that query needs a grant_id to join against (see
  // backoffice-metrics.ts's actionLists, fixed alongside this). Same
  // grant-matching shape as access-granted/route.ts: not revoked, matched
  // by this document directly or by its folder, document-level grant wins.
  const orParts = [`document_id.eq.${documentId}`];
  if (doc.folder_id) orParts.push(`folder_id.eq.${doc.folder_id}`);
  const { data: candidateGrants } = await admin.from('access_grants').select('id, document_id, folder_id, grantee_email, invited_email')
    .is('revoked_at', null).or(orParts.join(','));
  const matching = (candidateGrants ?? []).filter((g) =>
    (g.grantee_email as string | null)?.trim().toLowerCase() === email || (g.invited_email as string | null)?.trim().toLowerCase() === email);
  const grantId = matching.find((g) => g.document_id === documentId)?.id ?? matching[0]?.id ?? null;

  const { error } = await admin.from('document_views').insert({
    org_id: doc.org_id, document_id: documentId, grant_id: grantId, viewer_email: email,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
