// "Claim this profile" notifications — the claimant decision email (same
// shape as investor-access-request-notify.ts: one notify per decision,
// notified_at/notify_failed written in exactly one place) plus the §3.2
// tripwire, which is unique to this flow and has no equivalent elsewhere:
// on APPROVAL, the entity's own official contact is told who now manages
// their profile, so a successful impersonator is reported straight to the
// firm they impersonated — the strongest defense on the list because it
// works even if every other check above it was fooled.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, transactionalTemplate, resendConfigured } from './resend';
import { BRAND_NAME, APP_URL } from './brand';

export async function notifyClaimDecision(
  admin: SupabaseClient, opts: { id: string; claimantEmail: string; entityName: string; status: 'approved' | 'rejected' },
): Promise<{ notifyFailed: boolean }> {
  let notifyFailed = false;
  if (resendConfigured) {
    const r = opts.status === 'approved'
      ? await sendTransactionalEmail({
          to: opts.claimantEmail,
          subject: `Your claim on ${opts.entityName} is approved`,
          html: transactionalTemplate({
            heading: 'Your claim is approved',
            body: `You now manage ${opts.entityName}'s profile on ${BRAND_NAME}.`,
            ctaLabel: 'Open your workspace', ctaUrl: `${APP_URL}/portal`,
          }),
          context: { kind: 'other' },
        })
      : await sendTransactionalEmail({
          to: opts.claimantEmail,
          subject: `Your claim on ${opts.entityName}`,
          html: transactionalTemplate({
            heading: 'Your claim was not approved',
            body: `We reviewed your request to manage ${opts.entityName}'s profile on ${BRAND_NAME} and are not able to approve it at this time. Reply to this email if you have questions.`,
          }),
          context: { kind: 'other' },
        });
    notifyFailed = !r.sent;
  } else {
    notifyFailed = true;
  }
  await admin.from('investor_entity_claims').update({
    notified_at: notifyFailed ? null : new Date().toISOString(), notify_failed: notifyFailed,
  }).eq('id', opts.id);
  return { notifyFailed };
}

// Best-effort, fire-and-forget by design (never blocks or reverts the
// approval it follows) — see this file's own header for why this exists.
// contactEmails is whatever catalog_entities.email / general_partner_emails
// resolves to, already filtered to exclude the claimant's own address by
// the caller.
export async function sendClaimApprovalTripwire(
  opts: { contactEmails: string[]; claimantEmail: string; entityName: string },
): Promise<void> {
  if (!resendConfigured || opts.contactEmails.length === 0) return;
  const body = `Your ${entityNamePossessive(opts.entityName)} page on ${BRAND_NAME} is now managed by ${opts.claimantEmail}. `
    + `If you don't recognize this person, reply to this email right away.`;
  await Promise.all(opts.contactEmails.map((to) =>
    sendTransactionalEmail({
      to, subject: `${opts.entityName}'s ${BRAND_NAME} profile now has a manager`,
      html: transactionalTemplate({ heading: 'Your profile is now managed', body }),
      context: { kind: 'other' },
    }).catch(() => {}),
  ));
}

function entityNamePossessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

// Dispute — a second claim arrives on an entity that already has an
// approved owner. Not a rejection: it just needs the current owner to
// know, per §3.3 ("entram como disputa, com notificação ao dono actual").
export async function sendClaimDisputeNotice(
  opts: { ownerEmails: string[]; disputantEmail: string; entityName: string },
): Promise<void> {
  if (!resendConfigured || opts.ownerEmails.length === 0) return;
  const body = `${opts.disputantEmail} has also requested to manage ${opts.entityName}'s profile on ${BRAND_NAME}. `
    + `Our team will review this before anything changes — reply to this email if you have context that would help.`;
  await Promise.all(opts.ownerEmails.map((to) =>
    sendTransactionalEmail({
      to, subject: `Someone else has requested access to ${opts.entityName}'s profile`,
      html: transactionalTemplate({ heading: 'A second claim was submitted', body }),
      context: { kind: 'other' },
    }).catch(() => {}),
  ));
}
