// Prompt 277 A.3 — backoffice review queue for founder-submitted fraud/
// scam reports (entity_fraud_flags, migration 0196). List only — resolve
// (confirm/dismiss) lives in [id]/resolve/route.ts. Platform admin only,
// same requirePlatformAdmin() gate as every other /api/backoffice/* route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { entityFraudFlagsAvailable } from '@/lib/entity-fraud-flags-capability';
import { CROSS_ORG_FRAUD_THRESHOLD } from '@/lib/cross-org-fraud-threshold';

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
    // Prompt 285 §2 — dispute rows are propose-only (migration 0199): a
    // pre-migration row simply has no disputed_by key at all, filtered out
    // exactly like the other two nullable-user-id fields above.
    ...(rows ?? []).map((r) => r.disputed_by as string | null | undefined).filter((v): v is string => !!v),
  ]));
  const emailById = new Map<string, string>();
  for (const id of userIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }

  // Prompt 285 §3 — the cross-org aggregate for the badge: how many
  // DISTINCT orgs have a confirmed flag on the same catalog_id, so an
  // admin can see the pattern building before the threshold is reached
  // (which is applied automatically by resolve/route.ts, not decided
  // here — this is read-only).
  const catalogConfirmedOrgCount = new Map<string, number>();
  const catalogIds = Array.from(new Set((rows ?? []).map((r) => r.catalog_id as string | null).filter((v): v is string => !!v)));
  if (catalogIds.length) {
    const { data: confirmedFlags } = await admin.from('entity_fraud_flags')
      .select('catalog_id, org_id').in('catalog_id', catalogIds).eq('status', 'actioned').eq('outcome', 'confirmed');
    const orgsByCatalog = new Map<string, Set<string>>();
    for (const f of confirmedFlags ?? []) {
      const cid = f.catalog_id as string;
      if (!orgsByCatalog.has(cid)) orgsByCatalog.set(cid, new Set());
      orgsByCatalog.get(cid)!.add(f.org_id as string);
    }
    for (const [cid, orgSet] of orgsByCatalog) catalogConfirmedOrgCount.set(cid, orgSet.size);
  }

  return NextResponse.json({
    ok: true,
    crossOrgThreshold: CROSS_ORG_FRAUD_THRESHOLD,
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
        // Prompt 285 §2 — undefined (not present in the row at all) on a
        // pre-0199 database reads the same as null here; the client only
        // ever checks truthiness, never distinguishes the two.
        disputeReason: (r as Record<string, unknown>).dispute_reason ?? null,
        disputedAt: (r as Record<string, unknown>).disputed_at ?? null,
        disputedBy: (r as Record<string, unknown>).disputed_by
          ? (emailById.get((r as Record<string, unknown>).disputed_by as string) ?? (r as Record<string, unknown>).disputed_by)
          : null,
        crossOrgConfirmedCount: r.catalog_id ? (catalogConfirmedOrgCount.get(r.catalog_id as string) ?? 0) : null,
      };
    }),
  });
}
