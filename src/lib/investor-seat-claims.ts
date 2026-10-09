// Prompt 904 decision 3 (Nuno, 09/10/2026) — on a firm with a custom seat plan, a claimant whose email
// domain matches the firm's but who holds no reservation WAITS for the firm's administrator. This file is
// everything that follows from that: telling the administrators (email here; the platform shows it in
// Today and in the Seats panel), and the two things the administrator can do — accept or decline.
// Server-only: it sends mail and writes the claim row.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyClaimApproval } from './investor-entity-claims';
import { notifyClaimDecision } from './investor-entity-claim-notify';
import { checkSeatAvailable } from './investor-seats';
import { isSeatAdminRole, type PendingSeatClaim, type SeatActionResult } from './investor-firm-seats';
import { makeSeatStore } from './investor-firm-seats-store';
import { sendTransactionalEmail, transactionalTemplate } from './resend';
import { APP_URL, BRAND_NAME } from './brand';

/**
 * Tell the firm's administrators that someone is waiting. Best-effort: the claim is already recorded,
 * and the same fact is in their Today list and Seats panel whether or not an email gets through.
 * Returns how many administrators were addressed.
 */
export async function notifySeatAdminsOfPendingClaim(
  admin: SupabaseClient, args: { entityId: string; entityName: string; claimantEmail: string },
): Promise<number> {
  const members = await makeSeatStore(admin).activeMembers(args.entityId);
  const to = [...new Set(members.filter((m) => isSeatAdminRole(m.role) && m.email).map((m) => m.email as string))];
  await Promise.all(to.map((email) => sendTransactionalEmail({
    to: email,
    subject: `${args.claimantEmail} asked to join ${args.entityName} on ${BRAND_NAME}`,
    html: transactionalTemplate({
      heading: 'Someone asked to join your firm',
      body: `${args.claimantEmail} has an email address at your firm's domain and asked to claim ${args.entityName}'s profile on ${BRAND_NAME}. `
        + 'Nobody gets a seat without your approval: accept or decline in App access → Seats.',
      ctaLabel: 'Review the request', ctaUrl: `${APP_URL}/portal`,
      footer: 'If you do not recognise this person, decline the request.',
    }),
    context: { kind: 'other' },
  }).catch(() => ({ sent: false }))));
  return to.length;
}

export async function listPendingSeatClaims(admin: SupabaseClient, entityId: string): Promise<PendingSeatClaim[]> {
  return makeSeatStore(admin).pendingClaims(entityId);
}

async function loadClaim(admin: SupabaseClient, entityId: string, claimId: string) {
  // Scoped to THIS firm and to claims the administrator is allowed to see (domain match, still pending).
  const claims = await makeSeatStore(admin).pendingClaims(entityId);
  return claims.find((c) => c.id === claimId) ?? null;
}

/** The administrator accepts: the seat is taken within the plan's number, or the plan's reason is returned. */
export async function approvePendingSeatClaim(
  admin: SupabaseClient, args: { entityId: string; claimId: string; actorUserId: string },
): Promise<SeatActionResult> {
  const claim = await loadClaim(admin, args.entityId, args.claimId);
  if (!claim) return { ok: false, status: 404, error: 'Not found.' };

  const seat = await checkSeatAvailable(admin, args.entityId, claim.claimantUserId, claim.claimantEmail);
  if (!seat.allowed) return { ok: false, status: 409, error: seat.reason ?? 'No free seats.' };

  const applied = await applyClaimApproval(admin, {
    claimId: claim.id, catalogEntityId: args.entityId, claimantUserId: claim.claimantUserId,
    requestedRole: claim.requestedRole, resolvedBy: args.actorUserId, verificationMethod: 'domain',
    claimantEmail: claim.claimantEmail,
  });
  if (!applied.ok) return { ok: false, status: 500, error: applied.error };

  const store = makeSeatStore(admin);
  await store.recordEvent(args.entityId, 'claim_approved', args.actorUserId, { email: claim.claimantEmail });
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', args.entityId).maybeSingle();
  await notifyClaimDecision(admin, {
    id: claim.id, claimantEmail: claim.claimantEmail, entityName: (entity?.name as string | undefined) ?? 'your firm', status: 'approved',
  }).catch(() => {});
  return { ok: true };
}

/** The administrator declines. The claimant is told; nothing else changes. */
export async function declinePendingSeatClaim(
  admin: SupabaseClient, args: { entityId: string; claimId: string; actorUserId: string },
): Promise<SeatActionResult> {
  const claim = await loadClaim(admin, args.entityId, args.claimId);
  if (!claim) return { ok: false, status: 404, error: 'Not found.' };

  const { error } = await admin.from('investor_entity_claims').update({
    status: 'rejected', resolved_by: args.actorUserId, resolved_at: new Date().toISOString(),
  }).eq('id', claim.id).eq('status', 'pending');
  if (error) return { ok: false, status: 500, error: error.message };

  await makeSeatStore(admin).recordEvent(args.entityId, 'claim_declined', args.actorUserId, { email: claim.claimantEmail });
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', args.entityId).maybeSingle();
  await notifyClaimDecision(admin, {
    id: claim.id, claimantEmail: claim.claimantEmail, entityName: (entity?.name as string | undefined) ?? 'this profile', status: 'rejected',
  }).catch(() => {});
  return { ok: true };
}
