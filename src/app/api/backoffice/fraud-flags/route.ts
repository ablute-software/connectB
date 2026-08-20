// Prompt 277 A.3 — backoffice review queue for founder-submitted fraud/
// scam reports (entity_fraud_flags, migration 0196). List only — resolve
// (confirm/dismiss) lives in [id]/resolve/route.ts. Platform admin only,
// same requirePlatformAdmin() gate as every other /api/backoffice/* route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { entityFraudFlagsAvailable } from '@/lib/entity-fraud-flags-capability';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await entityFraudFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: rows, error } = await admin.from('entity_fraud_flags')
    .select('*').order('flagged_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const entityIds = Array.from(new Set((rows ?? []).map((r) => r.entity_id as string)));
  const { data: entities } = entityIds.length
    ? await admin.from('entities').select('id, name, org_id').in('id', entityIds)
    : { data: [] as { id: string; name: string; org_id: string }[] };
  const entityById = new Map((entities ?? []).map((e) => [e.id, e]));

  const orgIds = Array.from(new Set((entities ?? []).map((e) => e.org_id)));
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] as { id: string; name: string }[] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const userIds = Array.from(new Set([
    ...(rows ?? []).map((r) => r.flagged_by as string),
    ...(rows ?? []).map((r) => r.reviewed_by as string | null).filter((v): v is string => !!v),
  ]));
  const emailById = new Map<string, string>();
  for (const id of userIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }

  return NextResponse.json({
    ok: true,
    flags: (rows ?? []).map((r) => {
      const entity = entityById.get(r.entity_id as string);
      return {
        id: r.id, entityId: r.entity_id, entityName: entity?.name ?? '(deleted entity)',
        orgName: entity ? (orgNameById.get(entity.org_id) ?? '(deleted org)') : '(deleted org)',
        catalogId: r.catalog_id, justification: r.justification, evidence: r.evidence,
        flaggedBy: emailById.get(r.flagged_by as string) ?? r.flagged_by, flaggedAt: r.flagged_at,
        status: r.status, outcome: r.outcome,
        reviewedBy: r.reviewed_by ? (emailById.get(r.reviewed_by as string) ?? r.reviewed_by) : null,
        reviewedAt: r.reviewed_at, reviewerNotes: r.reviewer_notes,
      };
    }),
  });
}
