// Back-office queue for investor_entity_claims — mirrors
// investor-access-requests/route.ts's own shape (list + evidence, approve/
// reject are separate [id] routes). domain_match/evidence are read
// straight off the row: both are a SNAPSHOT taken at claim time (migration
// 0145's own comment), never recomputed here, so what the admin sees is
// exactly what the claimant's decision was actually based on.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { investorEntityClaimsAvailable } from '@/lib/investor-entity-claims-capability';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  if (!(await investorEntityClaimsAvailable())) return NextResponse.json({ ok: true, claims: [], available: false });

  const { data: claims, error } = await admin.from('investor_entity_claims')
    .select('id, catalog_entity_id, claimant_user_id, claimant_email, claimant_email_domain, entity_domain_at_claim, domain_match, status, requested_role, evidence, resolved_at, notified_at, notify_failed, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const entityIds = [...new Set((claims ?? []).map((c) => c.catalog_entity_id as string))];
  const { data: entities } = entityIds.length
    ? await admin.from('catalog_entities').select('id, name, website, verification_status').in('id', entityIds) : { data: [] };
  const entityById = new Map((entities ?? []).map((e) => [e.id as string, e]));

  return NextResponse.json({
    ok: true, available: true,
    claims: (claims ?? []).map((c) => ({ ...c, entity: entityById.get(c.catalog_entity_id as string) ?? null })),
  });
}
