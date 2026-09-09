// IRM_SPEC §1b — verify/reject a single contribution. Platform admin only.
// Promotion to a shared public catalog is NOT implemented here — entities/
// people don't have a catalog_entities-style public tier the way investor
// packs do, so "verified" means "the developer confirmed this is accurate,"
// visible in this feed, not yet "flows back to every org automatically."
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';
import { applyVerifiedContribution } from '@/lib/contribution-promotion';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { decision, notes } = await req.json();
  if (decision !== 'verified' && decision !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'decision must be verified or rejected' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: contribution } = await admin.from('contributions').select('subject_type, subject_id, field, value, org_id, kind').eq('id', params.id).maybeSingle();
  const { error } = await admin.from('contributions').update({
    status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), reviewer_notes: notes || null,
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Verifying a contribution here used to only flip its status — the value
  // never reached the entity/person row (the bug behind Banif Capital's
  // 14 "verified" facts and 0 populated fields). Promote it now, same rules
  // as a fresh AI proposal: never overwrite a field the subject already has.
  let promotion: { applied: boolean; reason: string } | null = null;
  // Prompt 632 §2.3 — an admin's approval is direct truth for the CATALOGUE
  // too, not only for the founder's private row. Until this, "verified" here
  // wrote entities.<field> (applyVerifiedContribution) and nothing else: the
  // shared catalogue never learned anything from a human review, which is how
  // it stayed poor while 569 AI rows and 16 human rows were being approved.
  // catalog_entity_admin_set_field applies at verified_by_admin, so only a
  // verified_by_person value can outrank it; an ineligible field, a blank
  // value or a bad enum label returns false and is audited, never thrown.
  let catalog: { applied: boolean; catalogId: string | null } | null = null;
  if (decision === 'verified' && contribution) {
    promotion = await applyVerifiedContribution(admin, contribution as { subject_type: 'entity' | 'person'; subject_id: string; field: string; value: unknown; kind?: 'fill' | 'correction' });
    if (contribution.subject_type === 'entity') {
      const { data: ent } = await admin.from('entities').select('catalog_id').eq('id', contribution.subject_id).maybeSingle();
      let catalogId = (ent?.catalog_id as string | null) ?? null;
      if (!catalogId) {
        const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', contribution.subject_id).maybeSingle();
        catalogId = (delivery?.catalog_id as string | null) ?? null;
      }
      if (catalogId) {
        const { data: applied } = await admin.rpc('catalog_entity_admin_set_field', {
          p_catalog_id: catalogId, p_field: contribution.field, p_value: contribution.value,
        });
        catalog = { applied: applied === true, catalogId };
      } else {
        catalog = { applied: false, catalogId: null };
      }
    }
  }

  await logAdminAction(admin, {
    adminUserId: user.id, action: `contribution_${decision}`, subjectType: 'contribution', subjectId: params.id,
    detail: { ...contribution, notes, promotion, catalog },
  });

  return NextResponse.json({ ok: true, promotion, catalog });
}
