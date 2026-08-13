// Prompt 191 §A/§E.3 — edit a manual entities row before promoting/merging
// it, or dismiss it outright. Writes ONLY to the source entities row —
// never to catalog_entities directly; the correction only reaches the
// catalog once the admin then clicks "Add selected to catalog" (promote or
// merge, which both re-read entities fresh, so the fix flows through
// automatically). Dismiss marks catalog_review_status='dismissed' without
// touching the catalog at all, for the "not worth promoting or merging"
// case. Both require migration 0169 (proposed, not yet applied).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as {
    dismiss?: boolean;
    website?: string; hqCity?: string; hqCountry?: string;
    stageMin?: string; stageMax?: string;
    checkMinEur?: number | null; checkMaxEur?: number | null;
    sectors?: string[]; geographies?: string[];
  };

  const { data: existing, error: existErr } = await admin.from('entities').select('id, source').eq('id', params.id).maybeSingle();
  if (existErr) return NextResponse.json({ ok: false, error: existErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  if (existing.source !== 'manual') return NextResponse.json({ ok: false, error: 'Not a manually-added entity.' }, { status: 400 });

  if (body.dismiss) {
    const { error } = await admin.from('entities').update({ catalog_review_status: 'dismissed' }).eq('id', params.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAdminAction(admin, { adminUserId: userId, action: 'catalog_candidate_dismissed', subjectType: 'entity', subjectId: params.id, detail: {} });
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (body.website !== undefined) patch.website = body.website || null;
  if (body.hqCity !== undefined) patch.hq_city = body.hqCity || null;
  if (body.hqCountry !== undefined) patch.hq_country = body.hqCountry || null;
  if (body.stageMin !== undefined) patch.stage_min = body.stageMin || null;
  if (body.stageMax !== undefined) patch.stage_max = body.stageMax || null;
  if (body.checkMinEur !== undefined) patch.check_min_eur = body.checkMinEur;
  if (body.checkMaxEur !== undefined) patch.check_max_eur = body.checkMaxEur;
  if (body.sectors !== undefined) patch.sectors = body.sectors;
  if (body.geographies !== undefined) patch.invests_in_geographies = body.geographies;

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'No fields to update.' }, { status: 400 });

  const { error } = await admin.from('entities').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_candidate_edited', subjectType: 'entity', subjectId: params.id, detail: { fields: Object.keys(patch) } });
  return NextResponse.json({ ok: true });
}
