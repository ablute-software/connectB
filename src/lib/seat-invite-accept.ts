// Prompt 923 (B) — accepting a seat invitation, as pure rules over a few ports (the route wires them to Supabase, the tests to an in-memory world).
//
// An invitation is a seat the firm's administrator reserved for an EMAIL. Opening the link with an account:
//   • a new account (created by the code on the invitation page) or an existing one without a firm → joins the firm, the invitation is accepted, the person lands in the firm's workspace;
//   • an account that cannot join → the page says why and what to do; the invitation stays OPEN and is not spent, and the administrator sees "Couldn't be accepted" with the reason.
// Only the account whose CONFIRMED email is the invited one can accept: the link is a bearer token, the email is the proof.
//
// THE RULE "one firm per account" (confirmed 28/10/2026, to report to Nuno — it was NOT changed): today an account MAY belong to several investor firms. matchdeal_investor_members is unique per (user, firm) only, the
// self-link route upserts on that pair, and the code that needs "the" firm takes the oldest active membership (investor-membership.ts). So by default nothing refuses a person for belonging elsewhere. The refusal below
// ("This account already belongs to «Firm»…") exists, tested, behind `oneFirmPerAccount`, which stays OFF until Nuno decides.
export const ONE_FIRM_PER_ACCOUNT = false;

export type InviteStatus = 'open' | 'accepted' | 'cancelled';
export interface InviteRecord { id: string; entityId: string; firmName: string; email: string; status: InviteStatus; acceptedUserId: string | null; failureReason: string | null }
export interface InviteAccount { id: string; email: string | null; emailConfirmed: boolean }

export interface InvitePorts {
  invite(token: string): Promise<InviteRecord | null>;
  /** The investor firms this account holds an ACTIVE seat in. */
  activeFirms(userId: string): Promise<{ entityId: string; name: string }[]>;
  /** The firm's own seat rules for this person (plan ended? seats full? removed earlier?): null = fine, otherwise the sentence. */
  seatRefusal(entityId: string, userId: string, email: string): Promise<string | null>;
  /** Makes the person a member (and writes their name and role), and marks the invitation accepted — all or nothing. */
  join(args: { invite: InviteRecord; userId: string; email: string; name: string | null; jobRole: string | null }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The invitation was NOT accepted: remember why, for the administrator. It stays open. */
  fail(invite: InviteRecord, reason: string, userId: string | null): Promise<void>;
  /** A later success clears an earlier failure. */
  record(invite: InviteRecord, event: 'invite_accepted', userId: string): Promise<void>;
}

export type AcceptCode = 'invalid' | 'closed' | 'cancelled' | 'unconfirmed' | 'wrong_account' | 'other_firm' | 'seat_refused' | 'failed' | 'profile_required';
export type AcceptResult =
  | { ok: true; firmName: string; entityId: string; alreadyAccepted: boolean }
  | { ok: false; status: number; code: AcceptCode; error: string };

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '…';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
};

const sentence = {
  invalid: 'This invitation is not valid. Ask the person who invited you to send it again.',
  cancelled: (firm: string) => `This invitation was cancelled. Ask ${firm} to send you a new one.`,
  closed: 'This invitation has already been used.',
  unconfirmed: 'Confirm your email address first: use the code we sent you.',
  wrong: (invited: string) => `This invitation is for ${maskEmail(invited)}. Sign out and open the link again with that address.`,
  otherFirm: (firm: string) => `This account already belongs to «${firm}». Ask the inviter to use a different email, or leave «${firm}» first.`,
  profile: 'Tell us your name and your role at the firm to continue.',
};

export const normalizeInviteEmail = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

export async function acceptSeatInvite(
  ports: InvitePorts,
  input: { token: string; account: InviteAccount; profile?: { name?: string; role?: string } | null; needsProfile?: boolean; oneFirmPerAccount?: boolean },
): Promise<AcceptResult> {
  const invite = await ports.invite(input.token);
  if (!invite) return { ok: false, status: 404, code: 'invalid', error: sentence.invalid };
  const email = normalizeInviteEmail(input.account.email);

  // Already accepted: by this very account it is simply done (the page was opened twice); by anybody else it is spent.
  if (invite.status === 'accepted') {
    if (invite.acceptedUserId && invite.acceptedUserId === input.account.id) return { ok: true, firmName: invite.firmName, entityId: invite.entityId, alreadyAccepted: true };
    return { ok: false, status: 410, code: 'closed', error: sentence.closed };
  }
  if (invite.status === 'cancelled') return { ok: false, status: 410, code: 'cancelled', error: sentence.cancelled(invite.firmName) };

  // The proof is the confirmed email, never the link alone.
  if (!input.account.emailConfirmed || !email) return { ok: false, status: 403, code: 'unconfirmed', error: sentence.unconfirmed };
  if (email !== normalizeInviteEmail(invite.email)) return { ok: false, status: 403, code: 'wrong_account', error: sentence.wrong(invite.email) };

  const name = (input.profile?.name ?? '').trim().slice(0, 120);
  const jobRole = (input.profile?.role ?? '').trim().slice(0, 120);
  const firms = await ports.activeFirms(input.account.id);
  const already = firms.find((f) => f.entityId === invite.entityId);

  // A person who is already in THIS firm has nothing to join: the invitation is simply taken as accepted (no second seat).
  if (!already) {
    if (input.needsProfile && (!name || !jobRole)) return { ok: false, status: 422, code: 'profile_required', error: sentence.profile };
    if (input.oneFirmPerAccount && firms.length > 0) {
      const error = sentence.otherFirm(firms[0].name);
      await ports.fail(invite, error, input.account.id);
      return { ok: false, status: 409, code: 'other_firm', error };
    }
    const refusal = await ports.seatRefusal(invite.entityId, input.account.id, email);
    if (refusal) {
      await ports.fail(invite, refusal, input.account.id);
      return { ok: false, status: 409, code: 'seat_refused', error: refusal };
    }
  }
  const joined = await ports.join({ invite, userId: input.account.id, email, name: name || null, jobRole: jobRole || null });
  if (!joined.ok) {
    await ports.fail(invite, joined.error, input.account.id);
    return { ok: false, status: 409, code: 'failed', error: joined.error };
  }
  await ports.record(invite, 'invite_accepted', input.account.id);
  return { ok: true, firmName: invite.firmName, entityId: invite.entityId, alreadyAccepted: false };
}

/** What the administrator sees for each invitation. */
export type InviteDisplay = { state: 'open' | 'accepted' | 'failed'; label: 'Open' | 'Accepted' | "Couldn't be accepted"; reason: string | null };
export function inviteDisplay(i: { status: InviteStatus; failureReason: string | null }): InviteDisplay {
  if (i.status === 'accepted') return { state: 'accepted', label: 'Accepted', reason: null };
  if (i.status === 'open' && i.failureReason) return { state: 'failed', label: "Couldn't be accepted", reason: i.failureReason };
  return { state: 'open', label: 'Open', reason: null };
}
