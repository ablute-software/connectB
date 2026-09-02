// Item 1 (Lote E) — mints the guest-preview token for an invite grant.
// Called right after the "+ Invite someone new" flow creates the
// pending_confirmation access_grants row(s) for an email (documents/
// page.tsx's submitGrantTree). Per Nuno's own confirmed decision
// (2026-08-07): this fills access_grants.guest_token/guest_token_expires_at
// — the two columns migration 0114 already added for exactly this — in the
// same row an invite already creates, rather than a separate table. Token
// generation itself stays server-side (never in the browser), same
// mechanism as MatchDeal's pairing tokens (matchdeal-pairing.ts):
// crypto-random, opaque, never derived from the email or the grant id.
// Prompt 171 §A — this route now also sends the ONE email a guest invite
// should ever trigger automatically: the protected /guest/[token] preview
// link, never signInWithOtp/`/portal`. That OTP flow stays exclusively
// inside /guest/[token]'s own "Is this you?" CTA (Prompt 159), reached only
// after the recipient has already seen the gated preview — this route never
// creates a real account, only mints a token and (optionally) emails it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { ensureGuestToken } from '@/lib/guest-token-server';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { resendConfigured, sendTransactionalEmail } from '@/lib/resend';
import { buildGuestAccessEmail } from '@/lib/guest-access-email';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { APP_URL } from '@/lib/brand';

// Prompt 532 §11 — the retry loop is gone.
//
// It existed for one reason: the ad-hoc invite flow fired the access_grants
// insert without awaiting it and then called this route immediately, so the
// route slept and re-queried hoping the row had landed. That sequencing is
// fixed at the source — /api/data-room/invite-by-email now persists the
// grants and mints the token in ONE server call, in order — and every other
// caller of this route (Resend, Copy guest link) acts on a relationship that
// demonstrably already exists. There is nothing left to wait for, so the
// route no longer pretends there might be: a missing grant is now an honest,
// immediate "no pending invite" instead of 1.5 seconds of false hope.

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  if (!(await guestGrantTokenAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { orgId, invitedEmail, sendEmail } = await req.json().catch(() => ({})) as { orgId?: string; invitedEmail?: string; sendEmail?: boolean };
  const email = invitedEmail?.trim().toLowerCase();
  if (!orgId || !email) return NextResponse.json({ ok: false, error: 'orgId and invitedEmail are required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Prompt 244/245 — a blocked email never gets a fresh guest-preview link
  // minted or emailed, whether or not one was pending before the block.
  if (await isEmailBlocked(admin, email)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  // Idempotent by design — this is also what the "Copy guest link" button
  // calls (documents/page.tsx), any time after the invite, not just once at
  // creation. A grant that already has a live token gets it handed back
  // unchanged rather than silently rotated (a previously-shared link should
  // keep working); an expired one gets a fresh token + expiry.
  //
  // Prompt 530 — the mint/reuse itself now lives in ensureGuestToken()
  // (lib/guest-token-server.ts) so the access-change notification reuses
  // this exact token instead of minting a second one for the same
  // relationship. Same behaviour, one owner.
  const minted = await ensureGuestToken(admin, orgId, email);
  if (!minted.ok || !minted.token || !minted.expiresAt) {
    // 404 = nothing to send to; 409 = there IS a relationship but its access
    // has lapsed (the founder has to extend it first, which People & Access
    // can now do in place); 500 only for a genuine write failure.
    const status = minted.error === 'No pending invite found for that email yet.' ? 404
      : minted.error?.startsWith('This recipient') ? 409 : 500;
    return NextResponse.json({ ok: false, error: minted.error ?? 'Could not create a guest link.' }, { status });
  }
  const token = minted.token;
  const expiresAt = minted.expiresAt;

  // `sendEmail` is opt-in: "Copy guest link" (documents/page.tsx) mints/
  // fetches the SAME token without it — that button's whole point is the
  // founder sending it themselves, not the app auto-emailing on every click.
  if (!sendEmail) return NextResponse.json({ ok: true, token, expiresAt });

  // Prompt 171 §A — the actual bug fix. Never falls back to signInWithOtp
  // when Resend isn't configured/fails — the token mint above already
  // succeeded regardless, so the caller can always still offer "Copy guest
  // link" (documents/page.tsx surfaces emailError for exactly that).
  let emailSent = false;
  let emailError: string | undefined;
  if (!resendConfigured) {
    emailError = 'Could not send the invite email — copy the link below and send it yourself';
  } else {
    // Prompt 532 — the APPROVED v2 guest-access template, the same one
    // /api/data-room/invite-by-email sends, so a Resend is byte-identical to
    // the original invitation rather than a second, plainer email. The
    // recipient's name comes from the invite grant itself.
    const [{ data: org }, { data: inviteRow }] = await Promise.all([
      admin.from('orgs').select('name').eq('id', orgId).maybeSingle(),
      admin.from('access_grants').select('invited_name')
        .eq('org_id', orgId).eq('invited_email', email).is('revoked_at', null)
        .not('invited_name', 'is', null).limit(1).maybeSingle(),
    ]);
    const orgName = (org?.name as string | undefined) ?? 'A startup';

    try {
      const rendered = buildGuestAccessEmail({
        recipientEmail: email,
        invitedName: (inviteRow?.invited_name as string | undefined) ?? null,
        startupName: orgName,
        guestUrl: `${APP_URL}/guest/${token}`,
      });
      const result = await sendTransactionalEmail({
        to: email, subject: rendered.subject, html: rendered.html, text: rendered.text,
      });
      emailSent = result.sent;
      if (!result.sent) {
        console.error('[guest-invite] provider refused the send:', result.providerError ?? result.error);
        emailError = `Could not send the invite email (${result.error}) — copy the link below and send it yourself`;
      }
    } catch (e) {
      // A template with an unresolved placeholder must never go out.
      console.error('[guest-invite] email render failed:', (e as Error).message);
      emailError = 'Could not compose the invite email — copy the link below and send it yourself';
    }
  }

  return NextResponse.json({ ok: true, token, expiresAt, emailSent, emailError });
}
