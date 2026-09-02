import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Prompt 537 §1 — "a row on EVERY branch".
//
// The bug this closes was not that a send failed. It was that the failure
// left nothing readable behind: the provider's reason went to console.error
// (Vercel only) and the founder got a generic sentence. Three weeks were
// spent guessing at a string the provider had already returned.
//
// So the contract under test is coverage, not formatting: no path through
// sendTransactionalEmail may return without writing exactly one row —
// missing key, provider 4xx, thrown fetch, and success alike — and a failure
// row must carry the provider's VERBATIM text plus the exact `from` used.

const logged: Record<string, unknown>[] = [];
vi.mock('./email-send-log', () => ({
  logEmailSend: async (entry: Record<string, unknown>) => { logged.push(entry); },
  logEmailRenderFailure: async () => {},
}));

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.RESEND_FROM_EMAIL;

beforeEach(() => { logged.length = 0; });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_FROM === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = ORIGINAL_FROM;
  vi.unstubAllGlobals();
});

async function send(opts: Record<string, unknown> = {}) {
  const { sendTransactionalEmail } = await import('./resend');
  return sendTransactionalEmail({
    to: 'guest@example.com', subject: 'Your invitation', html: '<p>hi</p>',
    context: { orgId: 'org-1', kind: 'guest_invite', relatedGrantId: 'grant-1' },
    ...opts,
  } as Parameters<typeof sendTransactionalEmail>[0]);
}

describe('every outcome of sendTransactionalEmail writes exactly one row', () => {
  it('no API key -> one not_configured row, and the send is refused', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await send();
    expect(result.sent).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      status: 'not_configured', recipient: 'guest@example.com', kind: 'guest_invite',
      orgId: 'org-1', relatedGrantId: 'grant-1',
    });
  });

  it('provider 403 -> one failed row carrying the VERBATIM reason and the from used', async () => {
    // The exact production shape: an unverified sender domain. The point of
    // the whole prompt is that this string reaches a human.
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'Sherlock Deal <noreply@sherlockdeal.com>';
    vi.stubGlobal('fetch', async () => new Response(
      '{"statusCode":403,"message":"The sherlockdeal.com domain is not verified."}', { status: 403 },
    ));

    const result = await send();
    expect(result.sent).toBe(false);
    expect(logged).toHaveLength(1);
    const row = logged[0] as { status: string; providerError: string; fromAddressUsed: string };
    expect(row.status).toBe('failed');
    expect(row.providerError).toContain('403');
    expect(row.providerError).toContain('domain is not verified');
    expect(row.fromAddressUsed).toBe('Sherlock Deal <noreply@sherlockdeal.com>');
    // And the founder-facing sentence stays separate from the raw text.
    expect(result.error).not.toContain('domain is not verified');
  });

  it('a thrown fetch (DNS/TLS/timeout) -> one failed row, not silence', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    vi.stubGlobal('fetch', async () => { throw new Error('ETIMEDOUT'); });
    const result = await send();
    expect(result.sent).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'failed' });
    expect((logged[0] as { providerError: string }).providerError).toContain('ETIMEDOUT');
  });

  it('success -> one sent row carrying the provider id and the from used', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'Sherlock Deal <noreply@sherlockdeal.com>';
    vi.stubGlobal('fetch', async () => new Response('{"id":"re_123"}', { status: 200 }));
    const result = await send();
    expect(result.sent).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      status: 'sent', providerId: 're_123', fromAddressUsed: 'Sherlock Deal <noreply@sherlockdeal.com>',
    });
  });

  it('a caller that passes no context still produces a row, attributed to "other"', async () => {
    // Back-compatibility: the context is optional at the type level, and a
    // send with none must still be recorded rather than skipped.
    delete process.env.RESEND_API_KEY;
    const { sendTransactionalEmail } = await import('./resend');
    await sendTransactionalEmail({ to: 'x@example.com', subject: 's', html: '<p>h</p>' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ kind: 'other', recipient: 'x@example.com' });
  });
});
