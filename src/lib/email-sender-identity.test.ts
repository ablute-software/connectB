import { afterEach, describe, expect, it } from 'vitest';
import {
  resolvedFromAddress, resolvedReplyTo, domainOfSender, isSandboxSender, SANDBOX_SENDER_DOMAIN,
} from './email-sender-identity';

// Prompt 537 §2/§3 — the sender identity the health card reports MUST be the
// one the mailer uses. These tests exist because a health check that can
// drift from the thing it checks is worse than no health check: it would
// report "sending from X" while production sends from Y, and the next three
// weeks would go into debugging the report instead of the send.

const ORIGINAL = { from: process.env.RESEND_FROM_EMAIL, replyTo: process.env.RESEND_REPLY_TO };
afterEach(() => {
  if (ORIGINAL.from === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = ORIGINAL.from;
  if (ORIGINAL.replyTo === undefined) delete process.env.RESEND_REPLY_TO;
  else process.env.RESEND_REPLY_TO = ORIGINAL.replyTo;
});

describe('the configured sender wins, always', () => {
  it('RESEND_FROM_EMAIL is used verbatim when set', () => {
    process.env.RESEND_FROM_EMAIL = 'Sherlock Deal <noreply@sherlockdeal.com>';
    expect(resolvedFromAddress()).toBe('Sherlock Deal <noreply@sherlockdeal.com>');
    expect(domainOfSender(resolvedFromAddress())).toBe('sherlockdeal.com');
    expect(isSandboxSender(resolvedFromAddress())).toBe(false);
  });

  it('falls back to the provider sandbox when it is unset — and says so', () => {
    delete process.env.RESEND_FROM_EMAIL;
    // §3: exactly two states exist. This is the second one, and the whole
    // symptom follows from it — the sandbox sender is accepted only for the
    // account owner's own address, so a founder's invite to a third party is
    // refused while a test to yourself succeeds.
    expect(isSandboxSender(resolvedFromAddress())).toBe(true);
    expect(domainOfSender(resolvedFromAddress())).toBe(SANDBOX_SENDER_DOMAIN);
  });

  it('reply-to follows RESEND_REPLY_TO and is undefined when unset', () => {
    process.env.RESEND_REPLY_TO = 'sherlockdeal.com@gmail.com';
    expect(resolvedReplyTo()).toBe('sherlockdeal.com@gmail.com');
    delete process.env.RESEND_REPLY_TO;
    expect(resolvedReplyTo()).toBeUndefined();
  });
});

describe('domainOfSender', () => {
  it('handles both the display-name form and a bare address', () => {
    expect(domainOfSender('Name <a@b.example>')).toBe('b.example');
    expect(domainOfSender('a@b.example')).toBe('b.example');
  });

  it('lower-cases the domain, so a verified-domain comparison cannot miss on case', () => {
    expect(domainOfSender('Name <A@Sherlockdeal.COM>')).toBe('sherlockdeal.com');
  });

  it('returns null rather than guessing when there is no domain', () => {
    expect(domainOfSender('not-an-address')).toBeNull();
    expect(domainOfSender('trailing@')).toBeNull();
  });
});
