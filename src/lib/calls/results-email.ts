// Prompt 924 (Etapa 4, I2) — the email of a result: the call's header (the entity's logo and name, then the title of the call), the label of the result, the message, one button to the applicant's own area, and the
// platform's automated-message footer (Prompt 911), which the mailer appends. The message is the sanitised text built by buildMessage; the call's contact address (when it has one) is the Reply-To.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BRAND_NAME } from '@/lib/brand';
import { sendTransactionalEmail } from '@/lib/resend';
import { brandLine, emailLinkFor } from './applicant/notices';
import type { Call } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function resultEmailHtml(input: { callName: string; label: string; bodyHtml: string; brandHtml?: string; ctaUrl: string }): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1A1A1A;">
  <div style="font-size: 20px; font-weight: 700; color: #0E7490; margin-bottom: 24px;">${BRAND_NAME}</div>
  ${input.brandHtml ? `<div style="margin: -8px 0 16px;">${input.brandHtml}</div>` : ''}
  <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 4px;">${esc(input.callName)}</h1>
  <p style="font-size: 14px; font-weight: 600; color: #0E7490; margin: 0 0 16px;">${esc(input.label)}</p>
  <div style="font-size: 14px; line-height: 1.6; color: #374151; margin: 0 0 20px;">${input.bodyHtml}</div>
  <a href="${esc(input.ctaUrl)}" style="display: inline-block; background: #0E7490; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 600;">View your result</a>
</div>`.trim();
}

export interface ResultMail { subject: string; label: string; html: string; text: string }

/** Sends one result's email. Never throws: the answer says whether it went and, if not, what the provider said (the queue decides whether to try again). */
export async function sendResultEmail(admin: SupabaseClient, call: Pick<Call, 'id' | 'name' | 'promoterKind' | 'promoterId' | 'contactEmail'>, to: string, mail: ResultMail): Promise<{ sent: boolean; error: string | null }> {
  try {
    const url = `${emailLinkFor({ linkToken: null })}/calls`;
    const brandHtml = await brandLine(admin, call as Call);
    const res = await sendTransactionalEmail({
      to, subject: mail.subject,
      html: resultEmailHtml({ callName: call.name, label: mail.label, bodyHtml: mail.html, brandHtml, ctaUrl: url }),
      text: `${call.name}\n${mail.label}\n\n${mail.text}\n\nView your result: ${url}`,
      ...(call.contactEmail ? { replyTo: call.contactEmail } : {}),
      context: { kind: 'other' },
    });
    return res.sent === true ? { sent: true, error: null } : { sent: false, error: String(res.providerError ?? res.error ?? 'not sent').slice(0, 300) };
  } catch (e) {
    return { sent: false, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
