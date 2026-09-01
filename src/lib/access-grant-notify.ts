// Prompt 518 §2 — the email that tells someone they can now see the data room.
//
// THE BUG THIS EXISTS TO FIX. Five places create access_grants rows, and only
// ONE of them reliably emailed the recipient:
//   submitGrantTree (the manual "Grant access" panel)  — only for
//     "+ Invite someone new"; grantScope==='everyone' and already-known people,
//     by far the most common case, sent nothing at all.
//   data-room/access-requests/[id]/action                — best-effort, the
//     result thrown away in an empty catch, and for a requester with no
//     account the link was a bare ${APP_URL}/pipeline that shows them nothing.
//   founder/document-requests/respond                    — no email code at all.
//   founder/document-requests/fulfill-upload             — no email code at all.
//   submitAdHocEmailGrant                                — the only correct one.
// So "conceder acesso não dispara o email" was true for essentially every
// path a founder actually uses.
//
// resend.ts was never the problem: it already returns {sent:false, error}
// instead of throwing when RESEND_API_KEY is missing. The problem was that
// almost nobody called it, and the one caller that did discarded the answer.
// This module is the single place that decides WHAT LINK a recipient gets and
// then reports honestly whether the mail went out, so callers can surface it
// instead of pretending.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRawToken } from './matchdeal-pairing';
import { guestGrantTokenAvailable } from './access-requests-capability';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from './resend';
import { APP_URL, BRAND_NAME } from './brand';

// Same 14 days, and the same reasoning, as data-room/guest-invite's own
// GUEST_TOKEN_TTL_MS: long enough that "I'll look later" doesn't expire first,
// short enough that an unconfirmed link isn't guessable-and-valid forever.
const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AccessNotifyResult {
  /** No recipient could be resolved at all — nothing was attempted. */
  skipped?: 'no_recipient';
  sent: boolean;
  error?: string;
  /** The link the recipient was given, so a caller can offer "copy it yourself". */
  link?: string;
  to?: string;
}

/**
 * Resolve the one email address a grant should notify.
 * A person_id means a known contact (people.email_verified); otherwise the
 * invited/requested email carried on the request itself.
 */
export async function resolveGrantRecipient(
  admin: SupabaseClient, args: { personId?: string | null; invitedEmail?: string | null },
): Promise<{ email: string; hasAccount: boolean } | null> {
  if (args.personId) {
    const { data: person } = await admin.from('people').select('email_verified').eq('id', args.personId).maybeSingle();
    const email = (person?.email_verified as string | null) ?? null;
    if (email) return { email: email.trim().toLowerCase(), hasAccount: true };
  }
  const invited = args.invitedEmail?.trim().toLowerCase();
  return invited ? { email: invited, hasAccount: false } : null;
}

/**
 * A link that actually shows the recipient the files.
 *
 * For someone without a confirmed account this MUST be a /guest/{token} link:
 * the old `${APP_URL}/pipeline` fallback sent them to a page they cannot even
 * load, which is indistinguishable from no email at all. The token is minted
 * on their own pending grant, reusing a live one rather than rotating it so a
 * previously-shared link keeps working — the same rule guest-invite follows.
 */
export async function ensureAccessLink(
  admin: SupabaseClient, args: { orgId: string; email: string; hasAccount: boolean },
): Promise<string> {
  if (args.hasAccount) return `${APP_URL}/portal`;
  if (!(await guestGrantTokenAvailable())) return `${APP_URL}/portal`;

  const { data: grant } = await admin.from('access_grants')
    .select('id, guest_token, guest_token_expires_at')
    .eq('org_id', args.orgId).eq('invited_email', args.email)
    .is('confirmed_at', null).is('revoked_at', null)
    .order('granted_at', { ascending: false }).limit(1).maybeSingle();
  if (!grant) return `${APP_URL}/portal`;

  const live = grant.guest_token && grant.guest_token_expires_at
    && new Date(grant.guest_token_expires_at as string) > new Date();
  if (live) return `${APP_URL}/guest/${grant.guest_token as string}`;

  // Follow the real access's own expiry where there is one, exactly as
  // guest-invite does, so the link dies with the access rather than outliving
  // it or expiring while the access is still open.
  const { data: pending } = await admin.from('access_grants').select('expires_at')
    .eq('org_id', args.orgId).eq('invited_email', args.email)
    .is('confirmed_at', null).is('revoked_at', null);
  const dated = (pending ?? []).map((g) => g.expires_at as string | null).filter((e): e is string => !!e);
  const latest = dated.length > 0 ? dated.reduce((a, b) => (a > b ? a : b)) : null;

  const token = generateRawToken();
  const expiresAt = latest ?? new Date(Date.now() + GUEST_TOKEN_TTL_MS).toISOString();
  const { error } = await admin.from('access_grants')
    .update({ guest_token: token, guest_token_expires_at: expiresAt }).eq('id', grant.id as string);
  if (error) return `${APP_URL}/portal`;
  return `${APP_URL}/guest/${token}`;
}

/**
 * Tell one recipient their access is open, with a link that works for them.
 * NEVER throws: a failed send must not undo a grant that already committed —
 * but unlike the old empty `catch {}`, the failure comes back so the caller
 * can show it instead of implying the mail went out.
 */
export async function notifyAccessGranted(
  admin: SupabaseClient,
  args: { orgId: string; personId?: string | null; invitedEmail?: string | null; whatChanged?: string },
): Promise<AccessNotifyResult> {
  try {
    const recipient = await resolveGrantRecipient(admin, args);
    if (!recipient) return { skipped: 'no_recipient', sent: false };

    const link = await ensureAccessLink(admin, { orgId: args.orgId, email: recipient.email, hasAccount: recipient.hasAccount });
    if (!resendConfigured) {
      return { sent: false, to: recipient.email, link, error: 'Email is not configured — copy the link and send it yourself.' };
    }

    const { data: org } = await admin.from('orgs').select('name').eq('id', args.orgId).maybeSingle();
    const orgName = (org?.name as string | undefined) ?? 'A startup';
    const heading = `${orgName} granted you data-room access`;
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: heading,
      html: transactionalTemplate({
        heading,
        body: `${orgName} has opened access to ${args.whatChanged ?? 'files in their data room'} on ${BRAND_NAME}.`
          + `<br/><br/>You'll only see what has been shared with you, nothing else.`,
        ctaLabel: 'Open the data room',
        ctaUrl: link,
      }),
    });
    return {
      sent: result.sent, to: recipient.email, link,
      error: result.sent ? undefined : 'Could not send the email — copy the link and send it yourself.',
    };
  } catch (e) {
    // Defensive only. Everything above already handles its own failure
    // modes; this guarantees the promise never rejects into a caller that
    // has already written a grant.
    return { sent: false, error: (e as Error).message };
  }
}
