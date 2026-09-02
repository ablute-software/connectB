// Prompt 537 §2/§3 — the sender identity, in ONE place.
//
// This module contains no new address, no new domain and no new fallback.
// It is the expression that already lived inline in resend.ts, extracted so
// that /api/backoffice/email-health reports the value the mailer will
// actually use rather than a second copy of the same logic. A health check
// that can drift from the thing it checks is worse than none: it would
// report "sending from X" while production sends from Y, and the next three
// weeks would be spent debugging the report.
//
// Env resolution is unchanged and stays the only way to set this:
// RESEND_FROM_EMAIL when set, otherwise the provider's sandbox sender that
// was already the fallback. No address is hard-coded here that was not
// already hard-coded as that same fallback, none is added, and the
// configured sender is never replaced or overridden by code. Switching the
// platform to Sherlock Deal (§3) is a DNS verification plus an env var —
// see DECISIONS.md — and this file is deliberately incapable of doing it.
import { BRAND_NAME } from './brand';

export function resolvedFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || `${BRAND_NAME} Support <onboarding@resend.dev>`;
}

export function resolvedReplyTo(): string | undefined {
  return process.env.RESEND_REPLY_TO || undefined;
}

/** `Name <addr@host>` or a bare `addr@host` -> `host`. Null when unparseable. */
export function domainOfSender(fromValue: string): string | null {
  const angle = fromValue.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : fromValue).trim();
  const at = address.lastIndexOf('@');
  if (at < 0 || at === address.length - 1) return null;
  const domain = address.slice(at + 1).toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * The provider's sandbox sender is accepted without any domain of ours being
 * verified, but ONLY for the account owner's own address. That single fact
 * explains the entire symptom this prompt exists to end: a test to yourself
 * succeeds while every founder's invite to a third party is refused.
 */
export const SANDBOX_SENDER_DOMAIN = 'resend.dev';

export function isSandboxSender(fromValue: string): boolean {
  return domainOfSender(fromValue) === SANDBOX_SENDER_DOMAIN;
}
