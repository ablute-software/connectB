// Item 10 — shared by approve/reject/resend-notification so the three
// routes send the exact same email for the exact same decision, and the
// notified_at/notify_failed write only happens in one place. Same shape
// src/app/api/portal/pipeline/route.ts already uses for
// investor_relationship_decisions — not a new convention.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, transactionalTemplate, resendConfigured } from './resend';
import { BRAND_NAME, APP_URL } from './brand';

export async function notifyInvestorAccessDecision(
  admin: SupabaseClient, opts: { id: string; email: string; status: 'approved' | 'rejected' },
): Promise<{ notifyFailed: boolean }> {
  let notifyFailed = false;
  if (resendConfigured) {
    const r = opts.status === 'approved'
      ? await sendTransactionalEmail({
          to: opts.email,
          subject: `Your investor access to ${BRAND_NAME} is approved`,
          html: transactionalTemplate({
            heading: 'Your access request is approved',
            body: `You now have access to the ${BRAND_NAME} data room. Sign in to review the documents shared with you.`,
            ctaLabel: 'Open your workspace', ctaUrl: `${APP_URL}/portal`,
          }),
          context: { kind: 'access_notify' },
        })
      : await sendTransactionalEmail({
          to: opts.email,
          subject: `Your investor access request to ${BRAND_NAME}`,
          html: transactionalTemplate({
            heading: 'Your access request was not approved',
            body: `We reviewed your request for investor access to ${BRAND_NAME} and are not able to grant it at this time. Reply to this email if you have questions.`,
          }),
          context: { kind: 'access_notify' },
        });
    notifyFailed = !r.sent;
  } else {
    notifyFailed = true;
  }
  await admin.from('investor_access_requests').update({
    notified_at: notifyFailed ? null : new Date().toISOString(), notify_failed: notifyFailed,
  }).eq('id', opts.id);
  return { notifyFailed };
}
