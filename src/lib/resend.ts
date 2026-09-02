// NEXT_STEPS Phase 5 — transactional email via Resend. Server-only (uses the
// API key). Raw fetch, no SDK dependency, matching the Anthropic call
// convention already used in this codebase. Env-gated: callers check
// `resendConfigured` first and keep their existing fallback (e.g. a
// copyable link) when it's false — same pattern as the AI composer.
import 'server-only';
import { BRAND_NAME } from './brand';
import { logEmailSend, type EmailContext } from './email-send-log';
import { resolvedFromAddress, resolvedReplyTo } from './email-sender-identity';

export const resendConfigured = !!process.env.RESEND_API_KEY;

// Prompt 537 §1 — `context` is the ONLY addition to this function's inputs,
// and it changes nothing about what gets sent. It carries who the email is
// for (orgId), which path produced it (kind) and, for access emails, the
// grant behind it — so every attempt lands in email_send_log with the exact
// `from` used and the provider's verbatim answer. It is optional at the
// type level purely so the signature stays back-compatible; all 25 call
// sites pass it.
//
// Sender resolution below is UNTOUCHED, deliberately and under instruction:
// no address is hard-coded, no domain is hard-coded, the configured sender
// is not replaced, no temporary or alternate sender is introduced to make
// anything pass. The point of this prompt is that the code REPORTS what the
// sender is (see /api/backoffice/email-health) — §3 is infra, not code.
export async function sendTransactionalEmail(opts: {
  to: string; subject: string; html: string; replyTo?: string; text?: string; context?: EmailContext;
}) {
  const context: EmailContext = opts.context ?? { kind: 'other' };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Logged, not silent: an unset key used to be indistinguishable from a
    // successful send in the logs, which is how a broken notify path stayed
    // invisible. The returned message stays user-facing and vague on purpose.
    console.error('[resend] RESEND_API_KEY is not set — no email was sent.');
    await logEmailSend({
      ...context, recipient: opts.to, subject: opts.subject, status: 'not_configured',
      providerError: 'RESEND_API_KEY is not set in this environment.',
    });
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
  // Prompt 537 §2 — the SAME expression as before, moved to
  // email-sender-identity.ts so the back-office health card reports the value
  // this line actually resolves rather than a second copy of it. Behaviour
  // is byte-identical: RESEND_FROM_EMAIL when set, the pre-existing sandbox
  // fallback otherwise. No address added, none replaced.
  const from = resolvedFromAddress();
  const replyTo = opts.replyTo || resolvedReplyTo();
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // Prompt 532 — `text` is optional and additive: when a caller supplies
      // an approved plain-text part (the guest-access email does), Resend
      // sends a proper multipart message instead of HTML-only, which is both
      // an accessibility and a deliverability improvement. Callers that omit
      // it behave exactly as before. The `from` identity above is untouched.
      body: JSON.stringify({
        from, to: opts.to, subject: opts.subject, html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      // Prompt 532 — the provider's own reason used to be console-only, so a
      // misconfigured sender domain (a 403 "domain is not verified") was
      // indistinguishable in the product from a transient blip. The reason is
      // now returned as `providerError` for the caller to log and surface as
      // a failure CLASS. It is deliberately separate from `error`, which
      // stays the founder-facing sentence, and it never carries the API key.
      const detail = (await res.text()).slice(0, 300);
      console.error('Transactional email provider error:', res.status, detail);
      const providerError = `HTTP ${res.status}: ${detail}`;
      // Prompt 537 §1 — THIS is the line that ends three weeks of guessing.
      // The same string that used to exist only in a Vercel log now lands in
      // a table the founder and the back-office can read, next to the exact
      // `from` that produced it. A 403 on an unverified domain now says so.
      await logEmailSend({
        ...context, recipient: opts.to, subject: opts.subject, status: 'failed',
        providerError, fromAddressUsed: from,
      });
      return {
        sent: false,
        error: 'Email sending failed — try again in a moment.',
        providerError,
      };
    }
    const data = await res.json();
    await logEmailSend({
      ...context, recipient: opts.to, subject: opts.subject, status: 'sent',
      providerId: (data.id as string) ?? null, fromAddressUsed: from,
    });
    return { sent: true, id: data.id as string };
  } catch (e) {
    console.error('Transactional email provider threw:', (e as Error).message);
    // A thrown fetch (DNS, TLS, timeout) is as much a failed send as a 4xx,
    // and used to leave nothing behind at all.
    await logEmailSend({
      ...context, recipient: opts.to, subject: opts.subject, status: 'failed',
      providerError: `threw: ${(e as Error).message}`, fromAddressUsed: from,
    });
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
