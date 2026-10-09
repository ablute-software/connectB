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
import {
  customSeatLimitInfo, inviteToSeat, isSeatAdminRole, judgeSeats, normalizeSeatEmail, type PendingSeatClaim, type SeatActionResult,
} from './investor-firm-seats';
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
  admin: SupabaseClient, args: { entityId: string; claimId: string; actorUserId: string; via?: 'backoffice' },
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
  await store.recordEvent(args.entityId, 'claim_approved', args.actorUserId, { email: claim.claimantEmail, ...(args.via ? { via: args.via } : {}) });
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', args.entityId).maybeSingle();
  await notifyClaimDecision(admin, {
    id: claim.id, claimantEmail: claim.claimantEmail, entityName: (entity?.name as string | undefined) ?? 'your firm', status: 'approved',
  }).catch(() => {});
  return { ok: true };
}

/** The administrator declines. The claimant is told; nothing else changes. */
export async function declinePendingSeatClaim(
  admin: SupabaseClient, args: { entityId: string; claimId: string; actorUserId: string; via?: 'backoffice' },
): Promise<SeatActionResult> {
  const claim = await loadClaim(admin, args.entityId, args.claimId);
  if (!claim) return { ok: false, status: 404, error: 'Not found.' };

  const { error } = await admin.from('investor_entity_claims').update({
    status: 'rejected', resolved_by: args.actorUserId, resolved_at: new Date().toISOString(),
  }).eq('id', claim.id).eq('status', 'pending');
  if (error) return { ok: false, status: 500, error: error.message };

  await makeSeatStore(admin).recordEvent(args.entityId, 'claim_declined', args.actorUserId, { email: claim.claimantEmail, ...(args.via ? { via: args.via } : {}) });
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', args.entityId).maybeSingle();
  await notifyClaimDecision(admin, {
    id: claim.id, claimantEmail: claim.claimantEmail, entityName: (entity?.name as string | undefined) ?? 'this profile', status: 'rejected',
  }).catch(() => {});
  return { ok: true };
}

// --- Adenda 1 (09/10/2026): the back-office adds a person to a firm by email -------------------------------------

/** "You have been added to X": a notice on the platform (shown on their next visit) and an email. Never throws. */
export async function notifyAddedToFirm(
  admin: SupabaseClient, args: { email: string; entityId: string; entityName: string; hasAccount: boolean; actor: string | null },
): Promise<{ emailSent: boolean }> {
  await makeSeatStore(admin).addNotice(args.email, args.entityId, args.actor).catch(() => {});
  const r = await sendTransactionalEmail({
    to: args.email,
    subject: `You've been added to ${args.entityName} on ${BRAND_NAME}`,
    html: transactionalTemplate({
      heading: `You've been added to ${args.entityName}`,
      body: args.hasAccount
        ? `The ${BRAND_NAME} team gave you a seat on ${args.entityName}'s workspace. It is already active: sign in and you will find it.`
        : `The ${BRAND_NAME} team reserved a seat for you on ${args.entityName}'s workspace. Create your account with this email address (or sign in if you already have one) and claim the profile: the seat is waiting for you.`,
      ctaLabel: args.hasAccount ? 'Open your workspace' : 'Create your account', ctaUrl: `${APP_URL}/portal`,
    }),
    context: { kind: 'other' },
  }).catch(() => ({ sent: false }));
  return { emailSent: !!r.sent };
}

export type AddPersonOutcome = 'added' | 'reserved';

/**
 * Back-office "Add a person by email" on a firm with a custom plan.
 *  - An account with that email exists: the person is a member of the firm NOW, inside the plan's seats, with
 *    verification_method 'manual', an approved claim recorded in the back-office admin's name, and a history entry.
 *  - No account yet: a seat is reserved, exactly as "Reserve seat" does.
 * Either way the person is told, by email and on the platform. A full plan blocks with the plan's own sentence.
 */
export async function addPersonToFirm(
  admin: SupabaseClient, args: { entityId: string; entityName: string; email: string; actor: string },
): Promise<SeatActionResult<{ outcome: AddPersonOutcome; emailSent: boolean }>> {
  const store = makeSeatStore(admin);
  const email = normalizeSeatEmail(args.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  const plan = await store.getPlan(args.entityId);
  if (!plan) return { ok: false, status: 400, error: 'This firm has no custom seat plan yet. Assign one first, then add people.' };

  const userId = await store.userIdByEmail(email);
  if (!userId) {
    const reserved = await inviteToSeat(store, { entityId: args.entityId, email, actor: args.actor });
    if (!reserved.ok) return reserved;
    const { emailSent } = await notifyAddedToFirm(admin, { email, entityId: args.entityId, entityName: args.entityName, hasAccount: false, actor: args.actor });
    return { ok: true, outcome: 'reserved', emailSent };
  }

  const [members, invites] = await Promise.all([store.activeMembers(args.entityId), store.openInvites(args.entityId)]);
  if (members.some((m) => m.userId === userId)) return { ok: false, status: 409, error: 'That person already has a seat.' };
  // A seat reserved for THIS email is the one being used: it does not count against them.
  const verdict = judgeSeats(customSeatLimitInfo(plan), members.length + invites.filter((i) => i.email !== email).length);
  if (!verdict.allowed) return { ok: false, status: 409, error: verdict.reason ?? 'No free seats.' };

  // The claim: reuse the one the person already has pending, else record a new one. Approved in the admin's name.
  const { data: pending } = await admin.from('investor_entity_claims').select('id, requested_role')
    .eq('catalog_entity_id', args.entityId).eq('claimant_user_id', userId).eq('status', 'pending').maybeSingle();
  let claimId = (pending as { id?: string } | null)?.id ?? null;
  const created = !claimId;
  if (!claimId) {
    const { data: inserted, error: insErr } = await admin.from('investor_entity_claims').insert({
      catalog_entity_id: args.entityId, claimant_user_id: userId, claimant_email: email, domain_match: false, status: 'pending',
      evidence: { via: 'backoffice_add', addedBy: args.actor },
    }).select('id').single();
    if (insErr || !inserted) return { ok: false, status: 500, error: insErr?.message ?? 'Could not record the claim.' };
    claimId = (inserted as { id: string }).id;
  }
  const applied = await applyClaimApproval(admin, {
    claimId, catalogEntityId: args.entityId, claimantUserId: userId,
    requestedRole: (pending as { requested_role?: string | null } | null)?.requested_role ?? null,
    resolvedBy: args.actor, verificationMethod: 'manual', claimantEmail: email,
  });
  if (!applied.ok) {
    // Do not leave a pending claim behind that we invented just now.
    if (created) await admin.from('investor_entity_claims').delete().eq('id', claimId).eq('status', 'pending');
    return { ok: false, status: 409, error: applied.error };
  }

  const seated = (await store.activeMembers(args.entityId)).find((m) => m.userId === userId);
  await store.recordActor(args.entityId, seated?.id ?? null, args.actor, { via: 'backoffice_add' });
  await store.recordEvent(args.entityId, 'claim_approved', args.actor, { email, via: 'backoffice_add' });
  const { emailSent } = await notifyAddedToFirm(admin, { email, entityId: args.entityId, entityName: args.entityName, hasAccount: true, actor: args.actor });
  return { ok: true, outcome: 'added', emailSent };
}
