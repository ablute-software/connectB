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
import { generateRawToken } from '@/lib/matchdeal-pairing';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { APP_URL } from '@/lib/brand';
import { renderGuestAccessEmailHtml, renderGuestAccessEmailText, guestAccessEmailSubject } from '@/lib/email-templates/guest-access-email';

// Decision (2026-08-07, per the mini-prompt's own ask to pick and record
// one): 14 days. Long enough that "I'll look at this later" doesn't expire
// before the investor gets to it, short enough that a stale, unconfirmed
// invite doesn't stay guessable-and-valid indefinitely. Prompt 171 §B — this
// is now only the FALLBACK for when none of the pending grants for this
// email have their own expires_at at all; when at least one does, the link
// follows the latest of those instead (see the mint branch below).
const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// The client-side access_grants insert (store-supabase.tsx's addGrant) is a
// fire-and-forget browser write, not awaited by its caller — this route can
// run before that insert has actually landed. A few short retries covers
// the real-world gap without the caller having to change how addGrant works.
const RESOLVE_RETRIES = 5;
const RESOLVE_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  type PendingGrant = { id: string; guest_token: string | null; guest_token_expires_at: string | null };
  let grant: PendingGrant | null = null;
  for (let attempt = 0; attempt < RESOLVE_RETRIES; attempt++) {
    const { data } = await admin.from('access_grants').select('id, guest_token, guest_token_expires_at')
      .eq('org_id', orgId).eq('invited_email', email).is('confirmed_at', null).is('revoked_at', null)
      .order('granted_at', { ascending: false }).limit(1).maybeSingle();
    if (data) { grant = data as PendingGrant; break; }
    await sleep(RESOLVE_DELAY_MS);
  }
  if (!grant) return NextResponse.json({ ok: false, error: 'No pending invite found for that email yet.' }, { status: 404 });

  let token: string;
  let expiresAt: string;
  const stillLive = grant.guest_token && grant.guest_token_expires_at && new Date(grant.guest_token_expires_at) > new Date();
  if (stillLive) {
    // Unchanged from before — "a previously-shared link should keep
    // working," so a live token is handed back as-is, expiry included, not
    // recomputed against the pending grants' current state.
    token = grant.guest_token as string;
    expiresAt = grant.guest_token_expires_at as string;
  } else {
    // Prompt 171 §B — the link's own expiry follows the REAL access it
    // unlocks, not a flat 14 days: the latest expires_at among every
    // currently-pending grant for this email (Nuno's decision — the link
    // stays open as long as at least one grant behind it still is;
    // individual documents still disappear the moment their OWN grant
    // expires, enforced separately via grantIsActive/grantStatus in
    // /api/guest/[token]/route.ts). Only when NONE of the pending grants
    // have an expires_at at all (fully indefinite access) does this fall
    // back to the original 14-day default.
    const { data: pendingGrants } = await admin.from('access_grants').select('expires_at')
      .eq('org_id', orgId).eq('invited_email', email).is('confirmed_at', null).is('revoked_at', null);
    const datedExpiries = (pendingGrants ?? []).map((g) => g.expires_at as string | null).filter((e): e is string => !!e);
    const latestGrantExpiry = datedExpiries.length > 0 ? datedExpiries.reduce((a, b) => (a > b ? a : b)) : null;

    token = generateRawToken();
    expiresAt = latestGrantExpiry ?? new Date(Date.now() + GUEST_TOKEN_TTL_MS).toISOString();
    const { error } = await admin.from('access_grants')
      .update({ guest_token: token, guest_token_expires_at: expiresAt })
      .eq('id', grant.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

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
    const [{ data: org }, { data: inviterPerson }] = await Promise.all([
      admin.from('orgs').select('name').eq('id', orgId).maybeSingle(),
      // Best-effort personalization — company_people.email is free-text, not
      // guaranteed to match the inviter's auth email; falls back to that
      // email itself, then a generic "The team" if even that's missing.
      user.email ? admin.from('company_people').select('full_name').eq('org_id', orgId).ilike('email', user.email).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const orgName = (org?.name as string | undefined) ?? 'A startup';
    // Prompt 526 Part A — the approved design replaces the generic text shell
    // here. Same trigger point, same flow, same /guest/{token} link (Prompt
    // 171); only the HTML changed. plain_text.txt rides along as the multipart
    // alternative. `inviterName` is no longer used: the approved copy is from
    // the STARTUP, not from a named individual, and inventing a byline the
    // design does not have would be exactly the reinterpretation the brief
    // rules out.
    const { data: grantForName } = await admin.from('access_grants')
      .select('invited_name').eq('id', grant.id).maybeSingle();
    const vars = {
      invitedName: (grantForName?.invited_name as string | null) ?? null,
      startupName: orgName,
      guestAccessUrl: `${APP_URL}/guest/${token}`,
    };
    const result = await sendTransactionalEmail({
      to: email,
      subject: guestAccessEmailSubject(orgName),
      html: renderGuestAccessEmailHtml(vars),
      text: renderGuestAccessEmailText(vars),
    });
    emailSent = result.sent;
    if (!result.sent) emailError = 'Could not send the invite email — copy the link below and send it yourself';
  }

  return NextResponse.json({ ok: true, token, expiresAt, emailSent, emailError });
}
