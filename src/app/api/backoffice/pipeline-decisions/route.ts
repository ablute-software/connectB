// AP-15 — back-office view over every Pipeline Interested/Pass decision
// (investor_relationship_decisions), across all orgs. Read-only, same
// requirePlatformAdmin() gate as every other backoffice route. Includes
// the revocation/notification audit fields (AP-09) so support can answer
// "did the data room actually get revoked" and "did the founder get
// notified" without a raw SQL query.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: decisions } = await admin.from('investor_relationship_decisions')
    .select('id, org_id, investor_catalog_entity_id, decision, reason_detail, decided_at, access_revoked_count, notified_at, notify_failed')
    .order('decided_at', { ascending: false }).limit(200);

  const orgIds = [...new Set((decisions ?? []).map((d) => d.org_id as string))];
  const investorIds = [...new Set((decisions ?? []).map((d) => d.investor_catalog_entity_id as string))];
  const [{ data: orgs }, { data: investors }] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    investorIds.length ? admin.from('catalog_entities').select('id, name').in('id', investorIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const investorNameById = new Map((investors ?? []).map((i) => [i.id as string, i.name as string]));

  return NextResponse.json({
    ok: true,
    decisions: (decisions ?? []).map((d) => ({
      id: d.id, orgName: orgNameById.get(d.org_id as string) ?? 'Unknown startup',
      investorName: investorNameById.get(d.investor_catalog_entity_id as string) ?? 'Unknown investor',
      decision: d.decision, reasonDetail: d.reason_detail, decidedAt: d.decided_at,
      accessRevokedCount: d.access_revoked_count, notifiedAt: d.notified_at, notifyFailed: d.notify_failed,
    })),
  });
}
