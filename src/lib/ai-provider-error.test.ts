import { describe, expect, it, vi, afterEach } from 'vitest';
import { providerErrorMessage } from './ai-provider-error';

describe('providerErrorMessage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never returns the raw provider body', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."},"request_id":"req_011CeJ2AteczEUVa3cedPvFe"}';
    const message = providerErrorMessage('[test]', raw);
    expect(message).not.toContain('req_011CeJ2AteczEUVa3cedPvFe');
    expect(message).not.toContain('2026-09-01');
    expect(message).not.toContain('invalid_request_error');
  });

  it('logs the raw body server-side', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    providerErrorMessage('[test]', 'raw body detail');
    expect(spy).toHaveBeenCalledWith('[test] provider error:', 'raw body detail');
  });

  it('detects the usage-limit shape and returns the honest, non-account-specific message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC.' } });
    expect(providerErrorMessage('[test]', raw)).toBe('AI tools are temporarily unavailable — they\'ll be back soon.');
  });

  it('falls back to the generic message for a non-usage-limit provider error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'The service is temporarily overloaded.' } });
    expect(providerErrorMessage('[test]', raw)).toBe('AI assist failed — try again in a moment.');
  });

  it('lets a caller override the generic (non-usage-limit) message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } });
    expect(providerErrorMessage('[test]', raw, 'Custom failure copy.')).toBe('Custom failure copy.');
  });

  it('does not choke on a non-JSON raw body, and still falls back correctly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(providerErrorMessage('[test]', 'not json at all')).toBe('AI assist failed — try again in a moment.');
    expect(providerErrorMessage('[test]', 'contains the words usage limits somewhere')).toBe('AI tools are temporarily unavailable — they\'ll be back soon.');
  });

  it('an invalid_request_error that is NOT about usage limits still gets the generic message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens is too large.' } });
    expect(providerErrorMessage('[test]', raw)).toBe('AI assist failed — try again in a moment.');
  });

  // Prompt 378 — the VERBATIM error the account actually returned on
  // 2026-08-25, caught while verifying on production. It says nothing about
  // a "usage limit", so the original detector missed it and the founder got
  // "try again in a moment" for a call that could never succeed.
  it('detects the credit-balance shape (the real 2026-08-25 outage), not just "usage limit"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
    });
    expect(providerErrorMessage('[test]', raw)).toBe('AI tools are temporarily unavailable — they\'ll be back soon.');
  });

  it('never leaks billing/account wording to the client even when it detects it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low. Please go to Plans & Billing to upgrade or purchase credits.' },
    });
    const message = providerErrorMessage('[test]', raw);
    expect(message).not.toMatch(/credit|billing|balance|purchase/i);
  });
});
