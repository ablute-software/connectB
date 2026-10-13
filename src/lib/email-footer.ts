// Prompt 911 (follow-up, 13/10/2026) — platform emails carry NO Reply-To and say so in the footer.
//
// Nuno's decision: there is no public support address until support@sherlockdeal.com has forwarding, and the owner's inbox
// (sherlockdeal.com@gmail.com, until now the RESEND_REPLY_TO value) must never reach a user — a Reply-To is visible the moment someone
// replies. So the platform sends without a Reply-To and tells the reader where help is: the contact form. The one exception is an
// email that carries its own explicit Reply-To (a call's "Contact email for applicants", Prompt 907+): that one is a person's
// contact on purpose, so it does NOT get the "replies are not read" line.
//
// Pure (no server-only): the mailer and the tests share it.
export const CONTACT_URL = 'https://www.sherlockdeal.com/contact';
export const CONTACT_LABEL = 'sherlockdeal.com/contact';
export const AUTOMATED_FOOTER_TEXT = `This is an automated message. Replies are not read. Need help? Contact us at ${CONTACT_LABEL}`;

export function automatedFooterHtml(): string {
  return `<div data-automated-footer="1" style="max-width: 480px; margin: 16px auto 0; padding: 0 24px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.5; color: #9CA3AF;">This is an automated message. Replies are not read. Need help? Contact us at <a href="${CONTACT_URL}" style="color: #6B7280; text-decoration: underline;">${CONTACT_LABEL}</a></div>`;
}

/**
 * The html (and plain-text part, when the caller has one) of an email, with the automated-message footer appended — unless the
 * email has an explicit Reply-To of its own. Idempotent: an email that already carries the footer is not given a second one.
 */
export function withAutomatedFooter(parts: { html: string; text?: string; replyTo?: string }): { html: string; text?: string } {
  if (parts.replyTo) return { html: parts.html, text: parts.text };
  const html = parts.html.includes('data-automated-footer') ? parts.html : `${parts.html}\n${automatedFooterHtml()}`;
  const text = parts.text === undefined ? undefined
    : parts.text.includes(AUTOMATED_FOOTER_TEXT) ? parts.text : `${parts.text.replace(/\s+$/, '')}\n\n${AUTOMATED_FOOTER_TEXT}\n${CONTACT_URL}`;
  return { html, text };
}
