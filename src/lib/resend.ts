// NEXT_STEPS Phase 5 — transactional email via Resend. Server-only (uses the
// API key). Raw fetch, no SDK dependency, matching the Anthropic call
// convention already used in this codebase. Env-gated: callers check
// `resendConfigured` first and keep their existing fallback (e.g. a
// copyable link) when it's false — same pattern as the AI composer.
import 'server-only';
import { BRAND_NAME } from './brand';

export const resendConfigured = !!process.env.RESEND_API_KEY;

// Prompt 526 Part A — `text` added as an optional plain-text alternative.
// Standard for transactional mail: clients that refuse HTML, screen readers and
// most spam filters all prefer a multipart message, and Resend takes both parts
// in the same call. Optional, so every existing caller is unchanged.
export async function sendTransactionalEmail(opts: { to: string; subject: string; html: string; text?: string; replyTo?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Logged, not silent: an unset key used to be indistinguishable from a
    // successful send in the logs, which is how a broken notify path stayed
    // invisible. The returned message stays user-facing and vague on purpose.
    console.error('[resend] RESEND_API_KEY is not set — no email was sent.');
    return { sent: false, error: 'Email sending is not available in your workspace yet.' };
  }

  // Item 12 — "send as sherlockdeal.com@gmail.com" is impossible: an ESP
  // can't send FROM a domain it hasn't verified, and gmail.com isn't ours to
  // verify. Sending from it anyway gets rejected outright or, worse,
  // delivered with broken SPF/DKIM and dumped in spam. reply_to solves the
  // actual intent (replies land in the inbox Nuno reads) without any of
  // that: it isn't authenticated by SPF/DKIM, so it can point anywhere
  // today, no domain verification needed. Sender display name is the
  // brand; the address stays the verified Resend one until sherlockdeal.com
  // is verified in the provider (infra, not code — see DECISIONS.md).
  // RESEND_FROM_EMAIL/RESEND_REPLY_TO (when set) override both.
  const from = process.env.RESEND_FROM_EMAIL || `${BRAND_NAME} Support <onboarding@resend.dev>`;
  const replyTo = opts.replyTo || process.env.RESEND_REPLY_TO || undefined;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, ...(opts.text ? { text: opts.text } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) {
      console.error('Transactional email provider error:', (await res.text()).slice(0, 300));
      return { sent: false, error: 'Email sending failed — try again in a moment.' };
    }
    const data = await res.json();
    return { sent: true, id: data.id as string };
  } catch (e) {
    console.error('Transactional email provider threw:', (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}

// Clean, minimal transactional template — one shared shell for every
// platform email (invites now, confirmations/magic-links later).
export function transactionalTemplate(opts: { heading: string; body: string; ctaLabel?: string; ctaUrl?: string; footer?: string }) {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1A1A1A;">
  <div style="font-size: 20px; font-weight: 700; color: #0E7490; margin-bottom: 24px;">
    ${BRAND_NAME}
  </div>
  <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">${opts.heading}</h1>
  <p style="font-size: 14px; line-height: 1.6; color: #374151; margin: 0 0 20px;">${opts.body}</p>
  ${opts.ctaLabel && opts.ctaUrl ? `
  <a href="${opts.ctaUrl}" style="display: inline-block; background: #0E7490; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 600;">
    ${opts.ctaLabel}
  </a>` : ''}
  ${opts.footer ? `<p style="margin-top: 28px; font-size: 12px; color: #9CA3AF;">${opts.footer}</p>` : ''}
</div>`.trim();
}
