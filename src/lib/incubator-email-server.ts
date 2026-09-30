// Prompt I-01 §C.5 — sends the incubator e-mails through the platform's one
// transactional path (resend.ts → email_send_log), never a new sender.
import 'server-only';
import { sendTransactionalEmail, transactionalTemplate } from './resend';
import type { EmailKind } from './email-send-log';
import { escapeHtml, type BuiltEmail } from './email-templates/incubator-emails';

export async function sendIncubatorEmail(to: string, email: BuiltEmail, ctx: { kind: EmailKind; orgId?: string | null }) {
  const html = transactionalTemplate({
    heading: escapeHtml(email.heading),
    body: escapeHtml(email.body).replace(/\n/g, '<br/>'),
    ctaLabel: email.ctaLabel ? escapeHtml(email.ctaLabel) : undefined,
    ctaUrl: email.ctaUrl,
  });
  return sendTransactionalEmail({ to, subject: email.subject, html, text: email.text, context: { kind: ctx.kind, orgId: ctx.orgId ?? null } });
}
