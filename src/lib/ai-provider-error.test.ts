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
});
