// IRM_SPEC §1b — verify/reject a single contribution. Platform admin only.
// Promotion to a shared public catalog is NOT implemented here — entities/
// people don't have a catalog_entities-style public tier the way investor
// packs do, so "verified" means "the developer confirmed this is accurate,"
// visible in this feed, not yet "flows back to every org automatically."
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

  const { decision, notes } = await req.json();
  if (decision !== 'verified' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be verified or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: contribution } = await admin.from('contributions').select('subject_type, subject_id, field, value, org_id').eq('id', params.id).maybeSingle();
  const { error } = await admin.from('contributions').update({
    status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), reviewer_notes: notes || null,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: user.id, action: `contribution_${decision}`, subjectType: 'contribution', subjectId: params.id,
    detail: { ...contribution, notes },
  });

  return NextResponse.json({ ok: true });
}
