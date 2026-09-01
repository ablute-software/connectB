import 'server-only';
// Prompt 518 §2 — the access email, for every path that creates a grant.
//
// Five places wrote to access_grants and only one of them reliably emailed
// anybody. Granting access therefore looked like it worked and the recipient
// was simply never told — Nuno's "conceder acesso não dispara o email".
//
// The one path that was correct is /api/data-room/guest-invite (Prompt 171):
// mint an opaque guest_token on the grant row, email the /guest/{token} link,
// and report back whether the send actually happened. This is that behaviour
// lifted out so the grant paths can call it too, rather than a second, subtly
// different copy of it.
//
// WHY THE GUEST LINK FOR EVERYONE, INCLUDING PEOPLE WHO ALREADY HAVE ACCOUNTS.
// /guest/{token} never shows document CONTENT — only names and structure — and
// its CTA signs the visitor in via signInWithOtp to the grant's exact email. So
// for someone with an account it is a login path, and for someone without one it
// is the invite. Forwarding the link gains the forwarder nothing: the unlock
// only ever lands in the mailbox the grant names. One path, no branch that can
// rot, and the non-transferability argument stays true for both.
//
// Never throws: a grant that succeeded must not be rolled back because an email
// failed. Callers surface { emailSent, emailError } to the founder, who can
// still copy the link and send it themselves.
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRawToken } from '@/lib/matchdeal-pairing';
import { resendConfigured, sendTransactionalEmail } from '@/lib/resend';
import { isEmailBlocked } from '@/lib/blocked-emails-server';
import { APP_URL } from '@/lib/brand';
import { renderGuestAccessEmailHtml, renderGuestAccessEmailText, guestAccessEmailSubject } from '@/lib/email-templates/guest-access-email';

// Same 14 days guest-invite chose, and for the same reason: long enough that
// "later" doesn't expire first, short enough that an unconfirmed invite isn't
// guessable-and-valid forever. Only a fallback — a grant with its own
// expires_at governs the link instead.
const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const COPY_LINK_FALLBACK = 'Could not send the access email — copy the link and send it yourself.';

export interface AccessEmailResult {
  emailSent: boolean;
  emailError?: string;
  /** Present whenever a token exists, even if the email failed — that is what makes "copy the link" possible. */
  token?: string;
}

/**
 * Mint (or reuse) the guest token on `grantId` and email the recipient.
 * `recipientEmail` may be omitted for a person-scoped grant; it is then read
 * from the person's verified email.
 */
export async function sendAccessGrantedEmail(admin: SupabaseClient, args: {
  orgId: string;
  grantId: string;
  personId?: string | null;
  recipientEmail?: string | null;
}): Promise<AccessEmailResult> {
  try {
    let to = args.recipientEmail?.trim().toLowerCase() || null;
    if (!to && args.personId) {
      const { data: person } = await admin.from('people').select('email_verified').eq('id', args.personId).maybeSingle();
      to = ((person?.email_verified as string | null) ?? '').trim().toLowerCase() || null;
    }
    // Not an error the founder caused, but they must still be told: a grant
    // with no address to send to is exactly the silent case being fixed.
    if (!to) return { emailSent: false, emailError: 'No email address on file for this person — copy the link and send it yourself.' };

    if (await isEmailBlocked(admin, to)) {
      return { emailSent: false, emailError: 'This address is blocked — no access email was sent.' };
    }

    // Reuse a live token rather than rotating it: a link already shared must
    // keep working. Only mint when there is none or it has expired.
    const { data: grant } = await admin.from('access_grants')
      .select('guest_token, guest_token_expires_at, expires_at').eq('id', args.grantId).maybeSingle();
    const now = Date.now();
    const existing = grant?.guest_token as string | null | undefined;
    const existingExpiry = grant?.guest_token_expires_at as string | null | undefined;
    let token = existing ?? '';
    let expiresAt = existingExpiry ?? '';
    if (!existing || !existingExpiry || new Date(existingExpiry).getTime() <= now) {
      token = generateRawToken();
      expiresAt = (grant?.expires_at as string | null) ?? new Date(now + GUEST_TOKEN_TTL_MS).toISOString();
      const { error } = await admin.from('access_grants')
        .update({ guest_token: token, guest_token_expires_at: expiresAt }).eq('id', args.grantId);
      if (error) return { emailSent: false, emailError: `Could not create the access link: ${error.message}` };
    }

    if (!resendConfigured) return { emailSent: false, emailError: COPY_LINK_FALLBACK, token };

    const { data: org } = await admin.from('orgs').select('name').eq('id', args.orgId).maybeSingle();
    const orgName = (org?.name as string | undefined) ?? 'A startup';
    // Prompt 526 Part A — the same approved template guest-invite sends, so a
    // grant answered from a request and an invite sent by hand produce the
    // identical email. invited_name is read from the grant when present.
    const { data: grantRow } = await admin.from('access_grants').select('invited_name').eq('id', args.grantId).maybeSingle();
    const vars = {
      invitedName: (grantRow?.invited_name as string | null) ?? null,
      startupName: orgName,
      guestAccessUrl: `${APP_URL}/guest/${token}`,
    };
    const result = await sendTransactionalEmail({
      to,
      subject: guestAccessEmailSubject(orgName),
      html: renderGuestAccessEmailHtml(vars),
      text: renderGuestAccessEmailText(vars),
    });
    return result.sent ? { emailSent: true, token } : { emailSent: false, emailError: COPY_LINK_FALLBACK, token };
  } catch (e) {
    // Never let an email failure escape into the grant's own transaction.
    return { emailSent: false, emailError: (e as Error).message || COPY_LINK_FALLBACK };
  }
}
