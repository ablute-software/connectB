// Prompt 557 §3 — Resend's delivery webhook, verified.
//
// Resend signs webhooks with Svix. The signature is what makes this endpoint
// safe to have public at all: without it, anyone who learned the URL could
// POST `{"type":"email.delivered"}` and paint the founder's People & Access
// screen with deliveries that never happened — the exact opposite of what
// this prompt is for. So verification is not optional and there is no
// "skip in development" branch: no secret configured means every request is
// rejected, and the endpoint is inert rather than forgeable.
//
// Pure on purpose (no next/server, no Supabase, no env reads): the route
// hands it the raw body, the three headers and the secret, and every rule
// below is unit-tested against real Svix-shaped inputs.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const RESEND_EVENT_TO_STATUS = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
} as const;

export type ResendEventType = keyof typeof RESEND_EVENT_TO_STATUS;
export type ResendMappedStatus = (typeof RESEND_EVENT_TO_STATUS)[ResendEventType];

export function statusForResendEvent(type: string): ResendMappedStatus | null {
  return (RESEND_EVENT_TO_STATUS as Record<string, ResendMappedStatus>)[type] ?? null;
}

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_secret' | 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

// Svix rejects anything more than five minutes out of step, and so do we:
// without it, one captured delivery POST could be replayed forever.
const TOLERANCE_SECONDS = 5 * 60;

/**
 * The signed payload is exactly `${id}.${timestamp}.${body}` — the RAW body
 * bytes, never a re-serialised object. A route that parsed the JSON first
 * and stringified it back would produce a different byte sequence for the
 * same request (key order, whitespace, unicode escapes) and every valid
 * signature would fail. That is why the route reads `await req.text()`.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string | undefined | null,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no_secret' };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'missing_headers' };
  if (Math.abs(nowMs / 1000 - sentAt) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };

  // Svix secrets are given as `whsec_<base64>`; the bytes that key the HMAC
  // are the decoded base64, not the prefixed string.
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');

  // The header carries a space-separated list of `v1,<sig>` — more than one
  // while a secret is being rotated. Any match is a pass.
  const candidates = signature.split(' ')
    .map((part) => part.split(',')[1] ?? '')
    .filter(Boolean);

  const expectedBuf = Buffer.from(expected);
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate);
    // timingSafeEqual throws on a length mismatch, so the length is checked
    // first — a wrong-length signature is simply not equal.
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

export interface ResendWebhookEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { message?: string }; reason?: string };
}

export interface ParsedResendEvent {
  status: ResendMappedStatus;
  providerId: string | null;
  recipient: string | null;
  occurredAt: string | null;
  reason: string | null;
}

/**
 * Reduces the event to the four things a log row needs. Returns null for an
 * event type this app does not track (`email.sent`, `email.opened`, …) so
 * the route can answer 200 and ignore it — a webhook that 500s on an event
 * it simply doesn't care about gets itself disabled by the provider.
 */
export function parseResendEvent(event: ResendWebhookEvent): ParsedResendEvent | null {
  const status = statusForResendEvent(event.type ?? '');
  if (!status) return null;
  const to = event.data?.to;
  return {
    status,
    providerId: event.data?.email_id ?? null,
    recipient: Array.isArray(to) ? (to[0] ?? null) : (to ?? null),
    occurredAt: event.created_at ?? null,
    reason: event.data?.bounce?.message ?? event.data?.reason ?? null,
  };
}

// A row only ever moves forward. Resend can deliver events out of order (a
// `delivered` arriving after a later `complained` is normal), and a
// synchronous failure must never be overwritten by a stray delivery event
// for a recycled provider id. Higher wins; equal or lower is ignored.
const RANK: Record<string, number> = {
  not_configured: 0, render_failed: 0, failed: 0,
  sent: 1, delayed: 2, delivered: 3, bounced: 4, complained: 5,
};

export function shouldApplyStatus(current: string | null | undefined, next: ResendMappedStatus): boolean {
  if (!current) return true;
  // A send that never reached the provider cannot later be "delivered".
  if (RANK[current] === 0) return false;
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}
