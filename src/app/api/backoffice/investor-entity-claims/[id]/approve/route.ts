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
import { notifyClaimDecision, sendClaimApprovalTripwire, splitEmails } from '@/lib/investor-entity-claim-notify';
import { checkSeatAvailable } from '@/lib/investor-seats';
import { applyClaimApproval } from '@/lib/investor-entity-claims';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  // Prompt 573 §B/§C — which of the two verification-method buttons the
  // admin actually clicked (Verify (domain) vs Verify (document)); falls
  // back to inferring from the claim's own domain_match for any caller that
  // doesn't pass it, so this stays backward-compatible.
  const { method } = await req.json().catch(() => ({})) as { method?: 'domain' | 'document' | 'manual' };

  const { data: claim, error: claimErr } = await admin.from('investor_entity_claims')
    .select('id, catalog_entity_id, claimant_user_id, claimant_email, requested_role, status, domain_match').eq('id', id).single();
  if (claimErr) return NextResponse.json({ ok: false, error: claimErr.message }, { status: 404 });
  if (claim.status === 'approved') return NextResponse.json({ ok: true, alreadyApproved: true });

  const { data: entity, error: entityErr } = await admin.from('catalog_entities')
    .select('id, name, email, general_partner_emails').eq('id', claim.catalog_entity_id).single();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });

  // Prompt 497 — the same seat limit the investor-facing link route
  // enforces. An admin approving a claim is the second (and only other) way
  // a seat lands on an already-existing firm, so it gets the same gate:
  // approving would silently push the firm over what its tier is billed
  // for. Deliberately a block with the reason, NOT a silent skip of the
  // member upsert — half-approving a claim (entity verified, claim marked
  // approved, no seat) would be worse than not approving it. Nothing is
  // written yet at this point, so the claim stays pending and re-approvable
  // once the plan is raised (Accounts → set investor plan) or a seat freed.
  const seatVerdict = await checkSeatAvailable(admin, claim.catalog_entity_id as string, claim.claimant_user_id as string);
  if (!seatVerdict.allowed) {
    return NextResponse.json({
      ok: false, error: `Seat limit reached for ${entity.name}. ${seatVerdict.reason}`,
      seatLimit: {
        tier: seatVerdict.tier, planName: seatVerdict.planName,
        limit: seatVerdict.limit, used: seatVerdict.used,
      },
    }, { status: 409 });
  }

  const resolvedMethod = method ?? (claim.domain_match ? 'domain' : 'manual');
  const applied = await applyClaimApproval(admin, {
    claimId: id, catalogEntityId: claim.catalog_entity_id as string, claimantUserId: claim.claimant_user_id as string,
    requestedRole: claim.requested_role as string | null, resolvedBy: userId, verificationMethod: resolvedMethod,
  });
  if (!applied.ok) return NextResponse.json({ ok: false, error: applied.error }, { status: 500 });

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
