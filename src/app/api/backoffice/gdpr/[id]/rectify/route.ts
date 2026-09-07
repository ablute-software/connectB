// Prompt 574 §A.3 — "Rectify -> ... ao gravar, o pedido fica resolved com
// verification_method-equivalente = 'rectified by <admin>'." The actual
// field correction happens in the founder's own People record — there is
// no admin-side editor for it (checked: /people/[id] is founder-session-
// scoped, RLS'd to org members; nothing in the backoffice edits another
// org's people rows directly) — so this route only marks the GDPR request
// itself resolved, once the admin confirms the correction was made.
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

  const { notes } = await req.json().catch(() => ({})) as { notes?: string };

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from('gdpr_requests').update({
    status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user.id,
    resolution_method: `rectified by ${user.email}`, reviewer_notes: notes?.trim() || null,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: user.id, action: 'gdpr_rectified', subjectType: 'gdpr_request', subjectId: params.id, detail: { notes } });
  return NextResponse.json({ ok: true });
}
