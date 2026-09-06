// Prompt 574 §A.3 — Erase, via the transactional erase_gdpr_person (migration
// 0321): required reason, real counts computed AND applied atomically, the
// resolved row keeps the removal summary (counts), never the removed data.
// "Nunca chamada com dados reais neste prompt" is about THIS session's own
// verification only — this route is real, shippable code; it has never been
// exercised here against anything but a throwaway zz-test-* fixture created
// and destroyed directly in SQL (see the Prompt 574 report).
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

  const { reason } = await req.json().catch(() => ({})) as { reason?: string };
  if (!reason?.trim()) return NextResponse.json({ ok: false, error: 'A reason is required to erase.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: request, error: reqErr } = await admin.from('gdpr_requests').select('id, claimant_email, status').eq('id', params.id).maybeSingle();
  if (reqErr || !request) return NextResponse.json({ ok: false, error: reqErr?.message ?? 'Request not found.' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ ok: false, error: 'This request is already resolved.' }, { status: 409 });

  const { data: summary, error: eraseErr } = await admin.rpc('erase_gdpr_person', {
    p_claimant_email: request.claimant_email, p_admin_id: user.id, p_reason: reason.trim(),
  });
  if (eraseErr) return NextResponse.json({ ok: false, error: eraseErr.message }, { status: 500 });

  const { error } = await admin.from('gdpr_requests').update({
    status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user.id,
    resolution_method: 'erased', reviewer_notes: reason.trim(), removal_summary: summary,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: user.id, action: 'gdpr_erased', subjectType: 'gdpr_request', subjectId: params.id, detail: { reason, summary } });
  return NextResponse.json({ ok: true, summary });
}
