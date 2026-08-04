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
  const { data: doc, error: docErr } = await admin.from('documents').select('org_id').eq('id', documentId).single();
  if (docErr || !doc) return NextResponse.json({ ok: false, error: docErr?.message ?? 'document not found' }, { status: 404 });

  const { error } = await admin.from('document_views').insert({
    org_id: doc.org_id, document_id: documentId, viewer_email: email,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
