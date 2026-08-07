// Approve a pending profile claim — §3.1: even with domain_match=true this
// always requires this explicit admin click, never an automatic approval.
// On approval: the claimant's matchdeal_investor_members seat gets
// domain_verified=true + the requested role, the entity becomes "managed"
// (verification_status='verified'), and two emails go out — the claimant's
// own decision notice (notifyClaimDecision, notified_at/notify_failed
// tracked on the claim row) and the §3.2 tripwire to the entity's OWN
// official contact (never blocking, never tracked on notified_at — a
// second, independent notification with its own best-effort posture).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { notifyClaimDecision, sendClaimApprovalTripwire } from '@/lib/investor-entity-claim-notify';

function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: claim, error: claimErr } = await admin.from('investor_entity_claims')
    .select('id, catalog_entity_id, claimant_user_id, claimant_email, requested_role, status').eq('id', id).single();
  if (claimErr) return NextResponse.json({ ok: false, error: claimErr.message }, { status: 404 });
  if (claim.status === 'approved') return NextResponse.json({ ok: true, alreadyApproved: true });

  const { data: entity, error: entityErr } = await admin.from('catalog_entities')
    .select('id, name, email, general_partner_emails').eq('id', claim.catalog_entity_id).single();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });

  const { error: memberErr } = await admin.from('matchdeal_investor_members').upsert({
    user_id: claim.claimant_user_id, catalog_entity_id: claim.catalog_entity_id,
    status: 'active', domain_verified: true, role: claim.requested_role,
  }, { onConflict: 'user_id,catalog_entity_id' });
  if (memberErr) return NextResponse.json({ ok: false, error: memberErr.message }, { status: 500 });

  // §3.3 — "aprovado um claim, a entidade fica gerida".
  const { error: entityUpdateErr } = await admin.from('catalog_entities').update({
    verification_status: 'verified', verified_at: new Date().toISOString(), verified_by: userId,
  }).eq('id', claim.catalog_entity_id);
  if (entityUpdateErr) return NextResponse.json({ ok: false, error: entityUpdateErr.message }, { status: 500 });

  const { error: claimUpdateErr } = await admin.from('investor_entity_claims').update({
    status: 'approved', resolved_by: userId, resolved_at: new Date().toISOString(),
  }).eq('id', id);
  if (claimUpdateErr) return NextResponse.json({ ok: false, error: claimUpdateErr.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'investor_entity_claim_approved', subjectType: 'investor_entity_claim',
    subjectId: id, detail: { catalogEntityId: claim.catalog_entity_id, claimantEmail: claim.claimant_email },
  });

  const { notifyFailed } = await notifyClaimDecision(admin, {
    id, claimantEmail: claim.claimant_email, entityName: entity.name as string, status: 'approved',
  });

  // §3.2 tripwire — best-effort, never affects the response or notifyFailed
  // above (that field tracks the CLAIMANT's own notification only).
  const contactEmails = [...new Set([...splitEmails(entity.email as string | null), ...splitEmails(entity.general_partner_emails as string | null)])]
    .filter((e) => e !== claim.claimant_email.toLowerCase());
  await sendClaimApprovalTripwire({ contactEmails, claimantEmail: claim.claimant_email, entityName: entity.name as string }).catch(() => {});

  return NextResponse.json({ ok: true, notifyFailed });
}
