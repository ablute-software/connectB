// IRM_SPEC §5/§6b-4 — resolve a GDPR request. Platform admin only.
// 'erase': actually nulls PII on every people row matching the claimant's
// email across every org (the real cascade the spec requires — people
// aren't a shared identity yet, so "every org affected" means "every org
// whose own people row matches this email"). 'rectify' has no generic
// auto-apply (the correction is field-specific); a developer edits the
// record via the normal entity/person screens, then marks this resolved.
// 'reject' just records the decision.
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
  const role = await resolveRole(user.id, user.email, sb);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { decision } = await req.json() as { decision?: 'resolved' | 'rejected' };
  if (decision !== 'resolved' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be resolved or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: request, error: reqErr } = await admin.from('gdpr_requests').select('*').eq('id', params.id).maybeSingle();
  if (reqErr || !request) return NextResponse.json({ ok: false, error: reqErr?.message ?? 'Request not found.' }, { status: 404 });

  let erasedCount = 0;
  if (decision === 'resolved' && request.kind === 'erase') {
    const { data: matches } = await admin.from('people').select('id').ilike('email_verified', request.claimant_email);
    const ids = (matches ?? []).map((m) => m.id);
    if (ids.length) {
      const { error } = await admin.from('people').update({
        full_name: '[erased on request]', email_verified: null, phone: null, linkedin_url: null,
        linked_companies: [], linked_funds: [], do_not_contact: true,
      }).in('id', ids);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      erasedCount = ids.length;
    }
  }

  const { error } = await admin.from('gdpr_requests').update({
    status: decision, resolved_at: new Date().toISOString(),
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: user.id, action: `gdpr_${decision}`, subjectType: 'gdpr_request', subjectId: params.id,
    detail: { kind: request.kind, claimantEmail: request.claimant_email, erasedCount },
  });

  return NextResponse.json({ ok: true, erasedCount });
}
