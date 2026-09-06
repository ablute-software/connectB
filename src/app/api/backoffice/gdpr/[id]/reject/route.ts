// Prompt 574 §A.3 — "Reject (razão) — quando o requerente não prova ser a
// pessoa." Required reason, same as every other reject in this batch of
// prompts.
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
  if (!reason?.trim()) return NextResponse.json({ ok: false, error: 'A reason is required to reject.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from('gdpr_requests').update({
    status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: user.id, reviewer_notes: reason.trim(),
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: user.id, action: 'gdpr_rejected', subjectType: 'gdpr_request', subjectId: params.id, detail: { reason } });
  return NextResponse.json({ ok: true });
}
