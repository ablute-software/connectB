// BLOCO 3 — review a founder-submitted investor. Approve finds-or-creates
// the matching catalog_entities row (verified); reject marks the submission
// rejected without touching the catalog. Logs to admin_audit_log either way.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';
import { normalizeName } from '@/lib/catalog-dedupe';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { decision, notes } = await req.json() as { decision?: 'approved' | 'rejected'; notes?: string };
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be approved or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: sub, error: subErr } = await admin.from('investor_submissions').select('*').eq('id', params.id).maybeSingle();
  if (subErr || !sub) return NextResponse.json({ ok: false, error: subErr?.message ?? 'Submission not found.' }, { status: 404 });

  const reviewedAt = new Date().toISOString();
  let mergedCatalogId: string | null = null;

  if (decision === 'approved') {
    const payload = sub.payload as { name: string; type: string; hq_city?: string; hq_country?: string; sectors?: string[]; website?: string };
    const target = normalizeName(payload.name);
    const { data: candidates } = await admin.from('catalog_entities').select('id, name');
    const existing = (candidates ?? []).find((c) => normalizeName(c.name) === target);

    if (existing) {
      mergedCatalogId = existing.id;
      const { error } = await admin.from('catalog_entities').update({ verification_status: 'verified', verified_at: reviewedAt, verified_by: user.id }).eq('id', existing.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    } else {
      const { data: created, error } = await admin.from('catalog_entities').insert({
        name: payload.name, type: payload.type, hq_city: payload.hq_city ?? null, hq_country: payload.hq_country ?? null,
        sectors: payload.sectors ?? [], website: payload.website ?? null,
        verification_status: 'verified', verified_at: reviewedAt, verified_by: user.id,
        source: 'user_submission', notes: notes || null,
      }).select('id').single();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      mergedCatalogId = created.id;
    }
  }

  const { error } = await admin.from('investor_submissions').update({
    status: decision, reviewer_notes: notes || null, reviewed_by: user.id, reviewed_at: reviewedAt,
    merged_catalog_id: mergedCatalogId,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: user.id, action: `submission_${decision}`, subjectType: 'investor_submission', subjectId: params.id,
    detail: { orgId: sub.org_id, name: sub.payload?.name, mergedCatalogId, notes },
  });

  return NextResponse.json({ ok: true, mergedCatalogId });
}
