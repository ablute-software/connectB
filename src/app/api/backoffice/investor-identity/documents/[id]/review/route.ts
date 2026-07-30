// Identity verification Fase A (prompt 63), Bloco 3 review — approve/reject
// an uploaded verification document. Approve verifies the ENTITY the
// document was tied to (not just this one investor) — same entity-level
// design as everywhere else identity_status is computed: once a firm's
// legitimacy is established, every investor linked to it inherits the
// badge, they don't each need their own approved document.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { decision, notes } = await req.json() as { decision?: 'approved' | 'rejected'; notes?: string };
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be approved or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: doc } = await admin.from('investor_verification_documents').select('id, catalog_entity_id').eq('id', params.id).maybeSingle();
  if (!doc) return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });

  const reviewedAt = new Date().toISOString();
  const { error: docError } = await admin.from('investor_verification_documents').update({
    status: decision, reviewer_notes: notes || null, reviewed_by: user.id, reviewed_at: reviewedAt,
  }).eq('id', params.id);
  if (docError) return NextResponse.json({ ok: false, error: docError.message }, { status: 500 });

  if (decision === 'approved') {
    const { error: entityError } = await admin.from('catalog_entities').update({
      verification_status: 'verified', verified_at: reviewedAt, verified_by: user.id,
    }).eq('id', doc.catalog_entity_id);
    if (entityError) return NextResponse.json({ ok: false, error: entityError.message }, { status: 500 });
  }

  await logAdminAction(admin, {
    adminUserId: user.id, action: `investor_verification_document_${decision}`, subjectType: 'investor_verification_document',
    subjectId: params.id, detail: { catalogEntityId: doc.catalog_entity_id, notes },
  });

  return NextResponse.json({ ok: true });
}
