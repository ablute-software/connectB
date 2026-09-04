import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  parseResendEvent, RESEND_EVENT_TO_STATUS, shouldApplyStatus,
  statusForResendEvent, verifyResendSignature,
} from './resend-webhook';

// A real Svix-shaped secret: `whsec_` + base64. The HMAC is keyed on the
// DECODED bytes, which is the detail most hand-rolled verifiers get wrong.
const SECRET = 'whsec_' + Buffer.from('a-shared-secret-value').toString('base64');
const NOW = 1_772_000_000_000; // fixed clock, so the tolerance window is deterministic

function sign(body: string, id = 'msg_1', timestamp = String(Math.floor(NOW / 1000)), secret = SECRET) {
  const key = Buffer.from(secret.slice(6), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { id, timestamp, signature: `v1,${sig}` };
}

describe('verifyResendSignature', () => {
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });

  it('accepts a correctly signed request', () => {
    expect(verifyResendSignature(body, sign(body), SECRET, NOW)).toEqual({ ok: true });
  });

  // The point of the endpoint being public: without this, anyone who learns
  // the URL can paint the founder's screen with deliveries that never
  // happened. This is the single most important assertion in the file.
  it('rejects a forged signature', () => {
    const forged = { id: 'msg_1', timestamp: String(Math.floor(NOW / 1000)), signature: 'v1,' + Buffer.from('nope').toString('base64') };
    expect(verifyResendSignature(body, forged, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with a different secret', () => {
    const other = 'whsec_' + Buffer.from('a-different-secret').toString('base64');
    expect(verifyResendSignature(body, sign(body, 'msg_1', String(Math.floor(NOW / 1000)), other), SECRET, NOW))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  // The signature covers the exact bytes. A route that parsed the JSON and
  // stringified it back would land here on every request.
  it('rejects a body altered after signing, even by one character', () => {
    const headers = sign(body);
    expect(verifyResendSignature(body.replace('e1', 'e2'), headers, SECRET, NOW))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects when the secret is not configured — inert, never permissive', () => {
    expect(verifyResendSignature(body, sign(body), undefined, NOW)).toEqual({ ok: false, reason: 'no_secret' });
    expect(verifyResendSignature(body, sign(body), '', NOW)).toEqual({ ok: false, reason: 'no_secret' });
  });

  it('rejects missing or unparsable headers', () => {
    expect(verifyResendSignature(body, { id: null, timestamp: '1', signature: 'v1,x' }, SECRET, NOW).ok).toBe(false);
    expect(verifyResendSignature(body, { id: 'a', timestamp: null, signature: 'v1,x' }, SECRET, NOW).ok).toBe(false);
    expect(verifyResendSignature(body, { id: 'a', timestamp: '1', signature: null }, SECRET, NOW).ok).toBe(false);
    expect(verifyResendSignature(body, { id: 'a', timestamp: 'not-a-number', signature: 'v1,x' }, SECRET, NOW))
      .toEqual({ ok: false, reason: 'missing_headers' });
  });

  // Replay protection: a captured POST is valid for five minutes, not forever.
  it('rejects a timestamp outside the five-minute window, in both directions', () => {
    const old = String(Math.floor(NOW / 1000) - 6 * 60);
    const future = String(Math.floor(NOW / 1000) + 6 * 60);
    expect(verifyResendSignature(body, sign(body, 'msg_1', old), SECRET, NOW)).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifyResendSignature(body, sign(body, 'msg_1', future), SECRET, NOW)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('accepts a timestamp inside the window', () => {
    const recent = String(Math.floor(NOW / 1000) - 4 * 60);
    expect(verifyResendSignature(body, sign(body, 'msg_1', recent), SECRET, NOW)).toEqual({ ok: true });
  });

  it('accepts when any one of several space-separated signatures matches (secret rotation)', () => {
    const good = sign(body);
    const headers = { ...good, signature: `v1,${Buffer.from('stale').toString('base64')} ${good.signature}` };
    expect(verifyResendSignature(body, headers, SECRET, NOW)).toEqual({ ok: true });
  });

  it('does not throw on a signature of the wrong length', () => {
    expect(verifyResendSignature(body, { id: 'a', timestamp: String(Math.floor(NOW / 1000)), signature: 'v1,short' }, SECRET, NOW))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('statusForResendEvent / parseResendEvent', () => {
  it('maps each tracked event to its status', () => {
    expect(statusForResendEvent('email.delivered')).toBe('delivered');
    expect(statusForResendEvent('email.bounced')).toBe('bounced');
    expect(statusForResendEvent('email.complained')).toBe('complained');
    expect(statusForResendEvent('email.delivery_delayed')).toBe('delayed');
    expect(Object.keys(RESEND_EVENT_TO_STATUS)).toHaveLength(4);
  });

  // Resend disables an endpoint that keeps erroring, so an event we have no
  // column for must be ignored, not rejected.
  it('returns null for an untracked event rather than guessing', () => {
    expect(statusForResendEvent('email.sent')).toBeNull();
    expect(statusForResendEvent('email.opened')).toBeNull();
    expect(parseResendEvent({ type: 'email.opened', data: { email_id: 'e1' } })).toBeNull();
    expect(parseResendEvent({})).toBeNull();
  });

  it('pulls the provider id, first recipient, timestamp and reason off a bounce', () => {
    expect(parseResendEvent({
      type: 'email.bounced', created_at: '2026-09-03T10:00:00.000Z',
      data: { email_id: 'e1', to: ['a@hotmail.com'], bounce: { message: 'mailbox unavailable' } },
    })).toEqual({
      status: 'bounced', providerId: 'e1', recipient: 'a@hotmail.com',
      occurredAt: '2026-09-03T10:00:00.000Z', reason: 'mailbox unavailable',
    });
  });

  it('accepts `to` as a bare string as well as an array', () => {
    expect(parseResendEvent({ type: 'email.delivered', data: { email_id: 'e1', to: 'a@b.com' } })?.recipient).toBe('a@b.com');
  });

  it('leaves the optional fields null rather than inventing them', () => {
    expect(parseResendEvent({ type: 'email.delivered', data: {} }))
      .toEqual({ status: 'delivered', providerId: null, recipient: null, occurredAt: null, reason: null });
  });
});

describe('shouldApplyStatus', () => {
  it('moves a sent row forward through the provider states', () => {
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyStatus('sent', 'delayed')).toBe(true);
    expect(shouldApplyStatus('delayed', 'delivered')).toBe(true);
    expect(shouldApplyStatus('delivered', 'bounced')).toBe(true);
    expect(shouldApplyStatus('bounced', 'complained')).toBe(true);
  });

  // Resend redelivers and reorders. Without this, a `delivered` arriving
  // after a `bounced` would flip a real failure back to a success.
  it('never moves a row backwards, whatever order the events arrive in', () => {
    expect(shouldApplyStatus('bounced', 'delivered')).toBe(false);
    expect(shouldApplyStatus('complained', 'delivered')).toBe(false);
    expect(shouldApplyStatus('delivered', 'delayed')).toBe(false);
  });

  it('ignores a repeat of the status already recorded', () => {
    expect(shouldApplyStatus('delivered', 'delivered')).toBe(false);
  });

  // A send that never reached the provider has no provider event to receive;
  // if one shows up for a recycled id, the local truth wins.
  it('never overwrites a send that failed before the provider was reached', () => {
    for (const terminal of ['failed', 'not_configured', 'render_failed']) {
      expect(shouldApplyStatus(terminal, 'delivered')).toBe(false);
      expect(shouldApplyStatus(terminal, 'bounced')).toBe(false);
    }
  });

  it('applies to a row with no status yet', () => {
    expect(shouldApplyStatus(null, 'delivered')).toBe(true);
  });
});
