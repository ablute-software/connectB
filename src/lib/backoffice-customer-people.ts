// Prompt 907 §A — who is attached to a customer, for the back-office "Ficha do cliente": the people who can sign in
// to the account, and the invitations still waiting. Read-only context for support ("who do I write to, did they ever
// confirm their e-mail, when did anyone last log in?") — the actions stay on the moderation / Startups screens.
//
// Back-office only (the routes behind it are requirePlatformAdmin). It is NOT part of the Developer Viewer's
// resolveActingOrg: an admin reading a customer's roster here is a different thing from looking inside the org.
//
// Two shapes of customer, one result shape:
//   org              org_members (+ org_invitations, the "Invite teammates" table)
//   investor_entity  matchdeal_investor_members, active seats (+ investor_firm_seat_invites, the open ones)
//
// Facts that live on auth.users — the e-mail, whether it was confirmed, the last sign-in — come from
// auth.admin.getUserById, one call per member: a customer has a handful of people, never hundreds, so this is not the
// unbounded listUsers() scan the Startups list has to do for every org at once.
//
// Two honest limits, both visible in the data rather than papered over:
//  - org_members has NO created_at (checked against production, 13/10/2026). "Joined" is therefore the date the
//    member's invitation was ACCEPTED when there is one for that e-mail, otherwise the date the ACCOUNT was created —
//    which for the person who founded the org is the day they signed up. `joinedSource` says which of the two it is.
//  - org_invitations carries a secret `token` (the invite link). It is never selected here, and so can never reach the
//    page.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerPerson {
  userId: string;
  /** '(unknown)' when auth has no such user any more. */
  email: string;
  role: string | null;
  joinedAt: string | null;
  /** invitation: the invite was accepted that day · seat: the firm seat was created that day · account: the user's account was created that day. */
  joinedSource: 'invitation' | 'seat' | 'account' | null;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
}

export interface CustomerInvite {
  id: string;
  email: string;
  /** Firm seat invitations carry no role. */
  role: string | null;
  sentAt: string;
  /** Firm seat invitations do not expire. */
  expiresAt: string | null;
  expired: boolean;
}

export interface CustomerPeople { members: CustomerPerson[]; invites: CustomerInvite[] }

export const UNKNOWN_EMAIL = '(unknown)';

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, manager: 2, member: 3 };
const rank = (role: string | null) => (role != null && role in ROLE_RANK ? ROLE_RANK[role] : 9);

interface AuthFacts { email: string; emailConfirmed: boolean; lastSignInAt: string | null; createdAt: string | null }
const NO_USER: AuthFacts = { email: UNKNOWN_EMAIL, emailConfirmed: false, lastSignInAt: null, createdAt: null };

async function authFacts(admin: SupabaseClient, userId: string): Promise<AuthFacts> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const u = data?.user as { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null; last_sign_in_at?: string | null; created_at?: string | null } | null | undefined;
    if (!u) return NO_USER;
    return {
      email: u.email ?? UNKNOWN_EMAIL,
      emailConfirmed: !!(u.email_confirmed_at ?? u.confirmed_at),
      lastSignInAt: u.last_sign_in_at ?? null,
      createdAt: u.created_at ?? null,
    };
  } catch {
    return NO_USER;
  }
}

function byRoleThenEmail(a: CustomerPerson, b: CustomerPerson): number {
  return rank(a.role) - rank(b.role) || a.email.localeCompare(b.email);
}

function isExpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return !Number.isNaN(t) && t < now;
}

export async function loadOrgPeople(admin: SupabaseClient, orgId: string, now: number = Date.now()): Promise<CustomerPeople> {
  const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
    admin.from('org_members').select('user_id, role').eq('org_id', orgId),
    // Explicit columns: `token` (the invite link) must never be selected.
    admin.from('org_invitations').select('id, email, role, status, created_at, expires_at, accepted_at').eq('org_id', orgId),
  ]);
  const members = (memberRows ?? []) as { user_id: string; role: string | null }[];
  const invitations = (inviteRows ?? []) as { id: string; email: string; role: string | null; status: string; created_at: string; expires_at: string | null; accepted_at: string | null }[];

  const acceptedAtByEmail = new Map<string, string>();
  for (const i of invitations) {
    if (i.status !== 'accepted' || !i.accepted_at) continue;
    const key = i.email.trim().toLowerCase();
    const seen = acceptedAtByEmail.get(key);
    if (!seen || i.accepted_at > seen) acceptedAtByEmail.set(key, i.accepted_at);
  }

  const facts = await Promise.all(members.map((m) => authFacts(admin, m.user_id)));
  const people: CustomerPerson[] = members.map((m, i): CustomerPerson => {
    const f = facts[i];
    const accepted = acceptedAtByEmail.get(f.email.trim().toLowerCase());
    return {
      userId: m.user_id, email: f.email, role: m.role ?? null,
      joinedAt: accepted ?? f.createdAt,
      joinedSource: accepted ? 'invitation' : f.createdAt ? 'account' : null,
      emailConfirmed: f.emailConfirmed, lastSignInAt: f.lastSignInAt,
    };
  }).sort(byRoleThenEmail);

  const invites: CustomerInvite[] = invitations
    .filter((i) => i.status === 'pending')
    .map((i) => ({
      id: i.id, email: i.email, role: i.role ?? null, sentAt: i.created_at, expiresAt: i.expires_at ?? null,
      // Still `pending` in the table, but its date has passed: say so, because the person cannot use it any more.
      expired: isExpired(i.expires_at ?? null, now),
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return { members: people, invites };
}

export async function loadFirmPeople(admin: SupabaseClient, catalogEntityId: string): Promise<CustomerPeople> {
  const [{ data: seatRows }, { data: inviteRows }] = await Promise.all([
    admin.from('matchdeal_investor_members').select('user_id, role, status, created_at').eq('catalog_entity_id', catalogEntityId).eq('status', 'active'),
    admin.from('investor_firm_seat_invites').select('id, email, status, created_at').eq('catalog_entity_id', catalogEntityId).eq('status', 'open'),
  ]);
  const seats = (seatRows ?? []) as { user_id: string; role: string | null; created_at: string }[];
  const facts = await Promise.all(seats.map((s) => authFacts(admin, s.user_id)));
  const members: CustomerPerson[] = seats.map((s, i): CustomerPerson => ({
    userId: s.user_id, email: facts[i].email, role: s.role ?? null,
    joinedAt: s.created_at ?? null, joinedSource: s.created_at ? 'seat' : null,
    emailConfirmed: facts[i].emailConfirmed, lastSignInAt: facts[i].lastSignInAt,
  })).sort(byRoleThenEmail);

  const invites: CustomerInvite[] = ((inviteRows ?? []) as { id: string; email: string; created_at: string }[])
    .map((i) => ({ id: i.id, email: i.email, role: null, sentAt: i.created_at, expiresAt: null, expired: false }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return { members, invites };
}
