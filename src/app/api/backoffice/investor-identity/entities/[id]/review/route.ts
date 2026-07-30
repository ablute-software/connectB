// Identity verification Fase A (prompt 63), Bloco 1 review — approve/reject
// a catalog_entities row an investor added themselves ("my firm isn't
// listed"). Approve sets verification_status='verified' (the entity-level
// axis every linked investor's identity_status reads — see
// investor-identity.ts), which is also what makes the badge/RLS/pack
// eligibility all agree, same as any other verified catalog row.
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

  const { decision } = await req.json() as { decision?: 'approved' | 'rejected' };
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be approved or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from('catalog_entities').update({
    verification_status: decision === 'approved' ? 'verified' : 'rejected',
    verified_at: decision === 'approved' ? new Date().toISOString() : null,
    verified_by: decision === 'approved' ? user.id : null,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: user.id, action: `investor_added_entity_${decision}`, subjectType: 'catalog_entity', subjectId: params.id, detail: {},
  });

  return NextResponse.json({ ok: true });
}
