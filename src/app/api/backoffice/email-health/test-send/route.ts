// Prompt 537 §2 — "Send test email to me".
//
// Sends the REAL guest-access template (the one the founder's invites use)
// with placeholder-safe values, to the signed-in admin's own address and
// nowhere else. The recipient is taken from the session, never from the
// request body: a test-send endpoint that accepts an arbitrary `to` is an
// open relay wearing a back-office badge.
//
// It goes through sendTransactionalEmail like every other send, so it is
// logged by §1 with the same from_address_used and the same verbatim
// provider text. That is the point — the test and the real thing must fail
// identically, or the test proves nothing.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { serverClient } from '@/lib/supabase-server';
import { sendTransactionalEmail } from '@/lib/resend';
import { buildGuestAccessEmail } from '@/lib/guest-access-email';
import { logEmailRenderFailure } from '@/lib/email-send-log';
import { BRAND_NAME } from '@/lib/brand';
import { resolvedFromAddress } from '@/lib/email-sender-identity';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

export async function POST() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const to = user?.email;
  if (!to) return NextResponse.json({ ok: false, error: 'Your account has no email address.' }, { status: 400 });

  const context = { kind: 'other' as const };

  let rendered;
  try {
    rendered = buildGuestAccessEmail({
      recipientEmail: to,
      invitedName: null,
      startupName: `${BRAND_NAME} test`,
      // A real, resolvable URL shape with an obviously fake token: the point
      // is to prove the template renders and the provider accepts it, not to
      // mint a live guest link for a test.
      guestUrl: `${APP_URL}/guest/test-token-not-a-real-link`,
    });
  } catch (e) {
    // A render failure is the one outcome with no provider response to
    // report, so it gets its own logged status rather than vanishing.
    const reason = (e as Error).message;
    await logEmailRenderFailure(context, to, reason, 'Test send');
    return NextResponse.json({ ok: false, stage: 'render', error: reason }, { status: 500 });
  }

  const result = await sendTransactionalEmail({
    to, subject: `[test] ${rendered.subject}`, html: rendered.html, text: rendered.text, context,
  });

  return NextResponse.json({
    ok: result.sent,
    to,
    fromInEffect: resolvedFromAddress(),
    providerId: result.sent ? result.id : null,
    // The provider's own words, verbatim, straight back to the admin who
    // pressed the button. No interpretation, no generic sentence.
    error: result.sent ? null : (result.error ?? null),
    providerError: result.sent ? null : (result.providerError ?? null),
  }, { status: result.sent ? 200 : 502 });
}
