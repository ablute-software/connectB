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
import { checkSeatAvailable } from '@/lib/investor-seats';
import { syncInvestorProfileToCatalog } from '@/lib/investor-profile-sync';

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

  const { error: memberErr } = await admin.from('matchdeal_investor_members').upsert({
    user_id: claim.claimant_user_id, catalog_entity_id: claim.catalog_entity_id,
    status: 'active', domain_verified: true, role: claim.requested_role,
  }, { onConflict: 'user_id,catalog_entity_id' });
  if (memberErr) return NextResponse.json({ ok: false, error: memberErr.message }, { status: 500 });

  // Prompt 519 §2 — an approved claim is the other moment the platform learns
  // this profile speaks for this firm, so the same sync runs here. Without it
  // an investor who completed their profile BEFORE the claim was approved
  // would never have it reach the catalog: the save-time sync above had
  // nothing approved to attach it to yet.
  const claimSync = await syncInvestorProfileToCatalog(admin, claim.catalog_entity_id as string);
  if (claimSync.error) console.error('[investor-entity-claims/approve] catalog sync failed', claimSync.error);

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
