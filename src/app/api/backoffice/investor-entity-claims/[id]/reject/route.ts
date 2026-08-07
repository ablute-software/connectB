import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { notifyClaimDecision } from '@/lib/investor-entity-claim-notify';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: claim, error: claimErr } = await admin.from('investor_entity_claims')
    .select('id, catalog_entity_id, claimant_email, status').eq('id', id).single();
  if (claimErr) return NextResponse.json({ ok: false, error: claimErr.message }, { status: 404 });
  if (claim.status === 'rejected') return NextResponse.json({ ok: true, alreadyRejected: true });

  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', claim.catalog_entity_id).maybeSingle();

  const { error } = await admin.from('investor_entity_claims').update({
    status: 'rejected', resolved_by: userId, resolved_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'investor_entity_claim_rejected', subjectType: 'investor_entity_claim', subjectId: id });

  const { notifyFailed } = await notifyClaimDecision(admin, {
    id, claimantEmail: claim.claimant_email, entityName: (entity?.name as string) ?? 'this profile', status: 'rejected',
  });

  return NextResponse.json({ ok: true, notifyFailed });
}
