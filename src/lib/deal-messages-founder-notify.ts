// Prompt 680 — the investor->founder direction always emailed
// (/api/portal/messages's own POST, org.sender_email). A founder's reply
// notified nobody: an investor only found out by reopening the app. Shared
// between the two founder-side send routes (the reply-to-an-existing-thread
// one and the founder-initiate one) rather than duplicated in both.
//
// A deal_threads row belongs to the investor FIRM (investor_catalog_entity_id),
// not to one specific person — matchdeal_investor_members is a seat per
// person per firm — so this notifies every currently active seat, not just
// whoever happens to be signed in when they next open the app.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from './resend';

export async function notifyInvestorFirmOfFounderMessage(
  admin: SupabaseClient, opts: { orgId: string; investorCatalogEntityId: string },
): Promise<void> {
  if (!resendConfigured) return;

  const [{ data: org }, { data: members }] = await Promise.all([
    admin.from('orgs').select('name').eq('id', opts.orgId).maybeSingle(),
    admin.from('matchdeal_investor_members').select('user_id').eq('catalog_entity_id', opts.investorCatalogEntityId).eq('status', 'active'),
  ]);
  const recipients = await Promise.all((members ?? []).map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id as string);
    return data?.user?.email ?? null;
  }));

  const heading = 'New message from a startup';
  const emailBody = `${(org?.name as string | undefined) ?? 'A startup'} replied to your message.`;
  for (const to of new Set(recipients.filter((e): e is string => !!e))) {
    try {
      await sendTransactionalEmail({
        to, subject: heading,
        html: transactionalTemplate({ heading, body: emailBody, ctaLabel: 'Reply in your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/portal` }),
        context: { orgId: opts.orgId, kind: 'other' },
      });
    } catch { /* best-effort — the message itself is already recorded */ }
  }
}
