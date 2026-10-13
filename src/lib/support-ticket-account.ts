// Prompt 907 §B — which company a support ticket belongs to, so the back-office stops reading "test · Closed" and having
// to guess whose account that was.
//
// support_tickets already has org_id and user_id (support/submit stamps them from the caller's session); the list and the
// detail only ever showed the sender's typed name and e-mail. This resolves, for a batch of tickets:
//
//   linked, startup    org_id is set        → the org's name + the sender's role in it (org_members)
//   linked, investor   no org_id, a user_id → the firm the user holds an ACTIVE seat in (matchdeal_investor_members) +
//                                             their role there. Investors have no org, so org_id stays null for them.
//   not linked         neither              → "No account". When the e-mail (or the signed-in user) is nevertheless an
//                                             account, `matches` says which: "matches account X — not linked". That is the
//                                             case that matters for support: a customer writing from the contact form with
//                                             their real address, who the ticket does not know.
//
// org_id wins when both exist: it is the link the ticket itself carries. A user who is in both worlds (the @ablute.pt QA
// account) is shown under the org the ticket is stamped with.
//
// The e-mail → user lookup goes through seat_user_id_by_email (a SECURITY DEFINER function, service_role only, one indexed
// lookup): the JS admin SDK has no getUserByEmail, and an unbounded listUsers() scan per page load is what the Startups
// list already pays for and this must not add to. One call per DISTINCT e-mail, a few at a time.
import type { SupabaseClient } from '@supabase/supabase-js';

export type TicketAccountKind = 'org' | 'investor_entity';

export interface TicketAccountMatch {
  /** 'user' = the e-mail is an account, but of a user who belongs to no company. */
  kind: TicketAccountKind | 'user';
  id: string | null;
  name: string | null;
  href: string | null;
}

export interface TicketAccount {
  kind: TicketAccountKind | 'none';
  id: string | null;
  name: string | null;
  /** The sender's role in that org / firm; null when unknown or when they are not (or no longer) a member. */
  role: string | null;
  href: string | null;
  /** Only for kind 'none'. */
  matches: TicketAccountMatch | null;
}

export interface TicketAccountInput { id: string; org_id: string | null; user_id: string | null; email: string | null }

export const fichaHref = (kind: TicketAccountKind, id: string) => `/backoffice/ficha-cliente/${kind}/${id}`;

const NONE: TicketAccount = { kind: 'none', id: null, name: null, role: null, href: null, matches: null };

function unique<T>(xs: (T | null | undefined)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x != null && (x as unknown) !== ''))];
}

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

type Row = Record<string, unknown>;

// `.in(column, ids)` puts every id in the request URL; a long list has to go in pieces.
const IN_CHUNK = 100;
async function selectIn(admin: SupabaseClient, table: string, columns: string, column: string, ids: string[], eq: Record<string, string> = {}): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin.from(table).select(columns).in(column, ids.slice(i, i + IN_CHUNK));
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data } = await q;
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

export async function resolveTicketAccounts(admin: SupabaseClient, tickets: TicketAccountInput[]): Promise<Map<string, TicketAccount>> {
  const result = new Map<string, TicketAccount>();
  if (tickets.length === 0) return result;

  // ── org-linked tickets ────────────────────────────────────────────────────────
  const orgIds = unique(tickets.map((t) => t.org_id));
  const [orgNames, orgRoles] = await Promise.all([
    namesById(admin, 'orgs', orgIds),
    selectIn(admin, 'org_members', 'org_id, user_id, role', 'org_id', orgIds),
  ]);
  const roleInOrg = new Map(orgRoles.map((m) => [`${m.org_id}:${m.user_id}`, (m.role as string | null) ?? null]));

  // ── firm-linked tickets: no org, but a user who holds an active seat ──────────
  const noOrg = tickets.filter((t) => !t.org_id);
  const seatsByUser = await activeSeatsByUser(admin, unique(noOrg.map((t) => t.user_id)));
  const firmNames = await namesById(admin, 'catalog_entities', unique([...seatsByUser.values()].map((s) => s.catalog_entity_id)));

  const unlinked: TicketAccountInput[] = [];
  for (const t of tickets) {
    if (t.org_id) {
      result.set(t.id, {
        kind: 'org', id: t.org_id, name: orgNames.get(t.org_id) ?? null,
        role: t.user_id ? roleInOrg.get(`${t.org_id}:${t.user_id}`) ?? null : null,
        href: fichaHref('org', t.org_id), matches: null,
      });
      continue;
    }
    const seat = t.user_id ? seatsByUser.get(t.user_id) : undefined;
    if (seat) {
      result.set(t.id, {
        kind: 'investor_entity', id: seat.catalog_entity_id, name: firmNames.get(seat.catalog_entity_id) ?? null,
        role: seat.role, href: fichaHref('investor_entity', seat.catalog_entity_id), matches: null,
      });
      continue;
    }
    unlinked.push(t);
  }
  if (unlinked.length === 0) return result;

  // ── not linked: is the e-mail (or the signed-in user) an account anyway? ─────
  const emails = unique(unlinked.filter((t) => !t.user_id).map((t) => t.email?.trim().toLowerCase()));
  const userIdByEmail = new Map<string, string | null>();
  await inChunks(emails, 8, async (email) => {
    const { data } = await admin.rpc('seat_user_id_by_email', { p_email: email });
    userIdByEmail.set(email, typeof data === 'string' && data ? data : null);
  });
  const matchedUserOf = (t: TicketAccountInput): string | null =>
    t.user_id ?? userIdByEmail.get(t.email?.trim().toLowerCase() ?? '') ?? null;

  const matchedUserIds = unique(unlinked.map(matchedUserOf));
  const [memberships, matchedSeats] = await Promise.all([
    selectIn(admin, 'org_members', 'org_id, user_id, role', 'user_id', matchedUserIds),
    activeSeatsByUser(admin, matchedUserIds),
  ]);
  const orgOfUser = new Map<string, string>();
  for (const m of memberships) if (!orgOfUser.has(m.user_id as string)) orgOfUser.set(m.user_id as string, m.org_id as string);
  const [matchedOrgNames, matchedFirmNames] = await Promise.all([
    namesById(admin, 'orgs', unique([...orgOfUser.values()])),
    namesById(admin, 'catalog_entities', unique([...matchedSeats.values()].map((s) => s.catalog_entity_id))),
  ]);

  for (const t of unlinked) {
    const uid = matchedUserOf(t);
    let matches: TicketAccountMatch | null = null;
    if (uid) {
      const orgId = orgOfUser.get(uid);
      const seat = matchedSeats.get(uid);
      if (orgId) matches = { kind: 'org', id: orgId, name: matchedOrgNames.get(orgId) ?? null, href: fichaHref('org', orgId) };
      else if (seat) matches = { kind: 'investor_entity', id: seat.catalog_entity_id, name: matchedFirmNames.get(seat.catalog_entity_id) ?? null, href: fichaHref('investor_entity', seat.catalog_entity_id) };
      else matches = { kind: 'user', id: null, name: null, href: null };
    }
    result.set(t.id, { ...NONE, matches });
  }
  return result;
}

async function namesById(admin: SupabaseClient, table: 'orgs' | 'catalog_entities', ids: string[]): Promise<Map<string, string>> {
  return new Map((await selectIn(admin, table, 'id, name', 'id', ids)).map((r) => [r.id as string, r.name as string]));
}

async function activeSeatsByUser(admin: SupabaseClient, userIds: string[]): Promise<Map<string, { catalog_entity_id: string; role: string | null }>> {
  const out = new Map<string, { catalog_entity_id: string; role: string | null }>();
  const seats = await selectIn(admin, 'matchdeal_investor_members', 'user_id, catalog_entity_id, role, status', 'user_id', userIds, { status: 'active' });
  for (const s of seats) {
    // One user, one active seat in practice; if there are ever two, the first stays (stable, and never invented).
    if (!out.has(s.user_id as string)) out.set(s.user_id as string, { catalog_entity_id: s.catalog_entity_id as string, role: (s.role as string | null) ?? null });
  }
  return out;
}
