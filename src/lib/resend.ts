// NEXT_STEPS Phase 5 — transactional email via Resend. Server-only (uses the
// API key). Raw fetch, no SDK dependency, matching the Anthropic call
// convention already used in this codebase. Env-gated: callers check
// `resendConfigured` first and keep their existing fallback (e.g. a
// copyable link) when it's false — same pattern as the AI composer.
import 'server-only';
import { BRAND_NAME } from './brand';

export const resendConfigured = !!process.env.RESEND_API_KEY;

export async function sendTransactionalEmail(opts: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: 'Email sending is not available in your workspace yet.' };

  // Sender display name is the brand; the address stays the verified Resend
  // one until the sherlockdeal.com domain is verified in the provider — a
  // separate infra step. RESEND_FROM_EMAIL (when set) overrides both, so the
  // from-address switch is env-gated.
  const from = process.env.RESEND_FROM_EMAIL || `${BRAND_NAME} <onboarding@resend.dev>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) {
      console.error('Transactional email provider error:', (await res.text()).slice(0, 300));
      return { sent: false, error: 'Email sending failed — try again in a moment.' };
    }
    const data = await res.json();
    return { sent: true, id: data.id as string };
  } catch (e) {
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
