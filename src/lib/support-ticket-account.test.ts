// Prompt 907 §B — every support ticket says whose it is, through the REAL route handlers (the list and the detail) over an
// in-memory database: the org and the sender's role in it; a VC firm for an investor; "No account" for a visitor — and, when
// the visitor's e-mail is an account all the same, which one ("matches account X — not linked"); an account filter whose
// options do not vanish when you use it; and nothing about the existing queue (counts, order, suggestions out) changes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { fakeAdmin, fakeDb, type FakeDb } from '@/test/fake-supabase';

const h = vi.hoisted(() => ({ isAdmin: true, admin: null as unknown }));
vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (h.isAdmin
    ? { admin: h.admin, userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));
vi.mock('@/lib/upload-security-capability', () => ({ supportAttachmentScanAvailable: async () => false }));
vi.mock('@/lib/network-moderation-capability', () => ({ networkModerationAvailable: async () => false }));

import { GET as LIST } from '@/app/api/backoffice/support/route';
import { GET as DETAIL } from '@/app/api/backoffice/support/[id]/route';
import { resolveTicketAccounts } from '@/lib/support-ticket-account';

const ORG_A = 'a7a7a7a7-0000-4000-8000-0000000a0907'; // zz-test-907-about-food
const ORG_B = 'b7b7b7b7-0000-4000-8000-0000000b0907'; // zz-test-907-other
const FIRM = 'c7c7c7c7-0000-4000-8000-0000000c0907'; // zz-test-907-capital
const U_OWNER = 'u-owner'; const U_MEMBER = 'u-member'; const U_FORMER = 'u-former'; const U_OWNER_B = 'u-owner-b';
const U_INV = 'u-inv'; const U_LONE = 'u-lone'; const U_INV_REVOKED = 'u-inv-revoked';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let db: FakeDb;

function ticket(id: string, o: Record<string, unknown>) {
  return {
    id, created_at: minutesAgo(30), source: 'founder_app', org_id: null, user_id: null, name: 'zz-test sender', email: 'nobody@nowhere.example',
    category: 'question', subject: `subject ${id}`, message: 'zz-test message long enough', context: null, status: 'open', priority: 'normal',
    assigned_to: null, last_activity_at: minutesAgo(10), first_response_at: null, resolved_at: null, area: null, attachment_urls: [], ...o,
  };
}

function world(): FakeDb {
  const d = fakeDb({
    orgs: [{ id: ORG_A, name: 'zz-test-907-about-food' }, { id: ORG_B, name: 'zz-test-907-other' }],
    org_members: [
      { org_id: ORG_A, user_id: U_OWNER, role: 'owner' },
      { org_id: ORG_A, user_id: U_MEMBER, role: 'member' },
      { org_id: ORG_B, user_id: U_OWNER_B, role: 'owner' },
    ],
    catalog_entities: [{ id: FIRM, name: 'zz-test-907-capital' }],
    matchdeal_investor_members: [
      { id: 'm1', user_id: U_INV, catalog_entity_id: FIRM, status: 'active', role: 'member' },
      { id: 'm2', user_id: U_INV_REVOKED, catalog_entity_id: FIRM, status: 'revoked', role: 'member' },
    ],
    support_tickets: [
      ticket('t1-owner', { org_id: ORG_A, user_id: U_OWNER, email: 'owner@zz-test-907.example', subject: 'test', status: 'closed', last_activity_at: minutesAgo(5) }),
      ticket('t2-member', { org_id: ORG_A, user_id: U_MEMBER, email: 'member@zz-test-907.example', status: 'new' }),
      ticket('t3-former', { org_id: ORG_A, user_id: U_FORMER, email: 'former@zz-test-907.example' }),
      ticket('t4-investor', { source: 'investor_portal', user_id: U_INV, email: 'associate@capital.example' }),
      ticket('t5-visitor', { source: 'landing', email: 'visitor@nowhere.example' }),
      ticket('t6-owner-by-email', { source: 'landing', email: '  OWNER@zz-test-907.example ' }),
      ticket('t7-investor-by-email', { source: 'landing_investors', email: 'associate@capital.example' }),
      ticket('t8-lone-user', { source: 'founder_app', user_id: U_LONE, email: 'lone@zz-test-907.example' }),
      ticket('t9-revoked-seat', { source: 'investor_portal', user_id: U_INV_REVOKED, email: 'gone@capital.example' }),
      ticket('t10-owner-b', { org_id: ORG_B, user_id: U_OWNER_B, email: 'owner-b@zz-test-907.example' }),
      ticket('t11-suggestion', { org_id: ORG_A, user_id: U_OWNER, category: 'suggestion', email: 'owner@zz-test-907.example' }),
    ],
    support_ticket_events: [],
  });
  // e-mail → user id, the way seat_user_id_by_email answers (lower + trim)
  const byEmail: Record<string, string> = {
    'owner@zz-test-907.example': U_OWNER, 'associate@capital.example': U_INV, 'lone@zz-test-907.example': U_LONE,
  };
  d.rpc = { seat_user_id_by_email: (args: unknown) => byEmail[String((args as { p_email: string }).p_email).trim().toLowerCase()] ?? null };
  return d;
}

type Listed = { id: string; status: string; account: Record<string, unknown> };
async function list(query = '') {
  const res = await LIST(new Request(`https://example.test/api/backoffice/support${query}`));
  return { status: res.status, json: await res.json() as { ok: boolean; tickets: Listed[]; counts: Record<string, number>; accounts: Record<string, unknown>[]; noAccount: number } };
}
const byId = (r: { tickets: Listed[] }, id: string) => r.tickets.find((t) => t.id === id)!;

beforeEach(() => {
  db = world();
  h.admin = fakeAdmin(db);
  h.isAdmin = true;
});

describe('the list: an account on every ticket', () => {
  it('a startup ticket names the org, the sender\'s role in it, and links to the Ficha', async () => {
    const { json } = await list();
    expect(byId(json, 't1-owner').account).toEqual({
      kind: 'org', id: ORG_A, name: 'zz-test-907-about-food', role: 'owner', href: `/backoffice/ficha-cliente/org/${ORG_A}`, matches: null,
    });
    expect(byId(json, 't2-member').account).toMatchObject({ kind: 'org', name: 'zz-test-907-about-food', role: 'member' });
  });

  it('a sender who is no longer a member still shows the org, without inventing a role', async () => {
    const { json } = await list();
    expect(byId(json, 't3-former').account).toMatchObject({ kind: 'org', name: 'zz-test-907-about-food', role: null });
  });

  it('an investor ticket names the VC firm (from the active seat), with the seat\'s role', async () => {
    const { json } = await list();
    expect(byId(json, 't4-investor').account).toEqual({
      kind: 'investor_entity', id: FIRM, name: 'zz-test-907-capital', role: 'member', href: `/backoffice/ficha-cliente/investor_entity/${FIRM}`, matches: null,
    });
  });

  it('a visitor is "No account"', async () => {
    const { json } = await list();
    expect(byId(json, 't5-visitor').account).toEqual({ kind: 'none', id: null, name: null, role: null, href: null, matches: null });
  });

  it('...but if their e-mail is an account, it says which: "matches account X — not linked" (case and spaces ignored)', async () => {
    const { json } = await list();
    expect(byId(json, 't6-owner-by-email').account).toMatchObject({
      kind: 'none', matches: { kind: 'org', id: ORG_A, name: 'zz-test-907-about-food', href: `/backoffice/ficha-cliente/org/${ORG_A}` },
    });
    expect(byId(json, 't7-investor-by-email').account).toMatchObject({
      kind: 'none', matches: { kind: 'investor_entity', id: FIRM, name: 'zz-test-907-capital' },
    });
  });

  it('a signed-in user who belongs to no company is "No account", matched as a user without one', async () => {
    const { json } = await list();
    expect(byId(json, 't8-lone-user').account).toMatchObject({ kind: 'none', matches: { kind: 'user', id: null, name: null, href: null } });
  });

  it('a revoked seat is not an account: the ticket is not linked to that firm', async () => {
    const { json } = await list();
    expect(byId(json, 't9-revoked-seat').account.kind).toBe('none');
  });

  it('asks the e-mail lookup once per DISTINCT address, and never for a ticket that is already linked', async () => {
    await list();
    const calls = (db.rpcCalls ?? []).filter((c) => c.name === 'seat_user_id_by_email').map((c) => String((c.args as { p_email: string }).p_email));
    // t5, t6, t7 are the unlinked tickets without a user id (t8 has one; t9 has one)
    expect(calls.sort()).toEqual(['associate@capital.example', 'owner@zz-test-907.example', 'visitor@nowhere.example']);
  });
});

describe('the list: what it already did, unchanged', () => {
  it('keeps suggestions out, and the counts and the order of the queue', async () => {
    const { json } = await list();
    expect(json.tickets.map((t) => t.id)).not.toContain('t11-suggestion');
    expect(json.tickets).toHaveLength(10);
    expect(json.counts.new).toBe(1); // t2-member
    expect(json.counts.navBadge).toBe(1);
    // 'new' ranks before the others
    expect(json.tickets[0].id).toBe('t2-member');
  });

  it('the status / category / source filters still work, and combine with the account filter', async () => {
    expect((await list('?status=closed')).json.tickets.map((t) => t.id)).toEqual(['t1-owner']);
    expect((await list(`?source=landing&account=${ORG_A}`)).json.tickets).toEqual([]);
    expect((await list(`?status=open&account=${ORG_A}`)).json.tickets.map((t) => t.id)).toEqual(['t3-former']);
  });
});

describe('the account filter', () => {
  it('shows only that account\'s tickets', async () => {
    const { json } = await list(`?account=${ORG_A}`);
    expect(json.tickets.map((t) => t.id).sort()).toEqual(['t1-owner', 't2-member', 't3-former']);
    expect((await list(`?account=${FIRM}`)).json.tickets.map((t) => t.id)).toEqual(['t4-investor']);
  });

  it('"none" shows the tickets that belong to no account', async () => {
    const { json } = await list('?account=none');
    expect(json.tickets.map((t) => t.id).sort()).toEqual(['t5-visitor', 't6-owner-by-email', 't7-investor-by-email', 't8-lone-user', 't9-revoked-seat']);
  });

  it('offers every account that has tickets — built from ALL tickets, so choosing one does not empty the menu', async () => {
    const all = (await list()).json;
    const filtered = (await list(`?account=${ORG_A}`)).json;
    // by name, as the menu lists them
    expect(all.accounts).toEqual([
      { id: ORG_A, name: 'zz-test-907-about-food', kind: 'org', count: 3 },
      { id: FIRM, name: 'zz-test-907-capital', kind: 'investor_entity', count: 1 },
      { id: ORG_B, name: 'zz-test-907-other', kind: 'org', count: 1 },
    ]);
    expect(filtered.accounts).toEqual(all.accounts);
    expect(all.noAccount).toBe(5);
  });

  it('does not change what the counts say: they describe the whole queue, as before', async () => {
    expect((await list(`?account=${ORG_B}`)).json.counts).toEqual((await list()).json.counts);
  });
});

describe('the detail: the header\'s account', () => {
  async function detail(id: string) {
    const res = await DETAIL(new Request('https://example.test/x'), { params: { id } });
    return { status: res.status, json: await res.json() as { ok: boolean; ticket: Record<string, unknown>; account: Record<string, unknown> | null } };
  }

  it('"test · Closed · ABOUT FOOD (owner)": the ticket comes with its account and the sender\'s role', async () => {
    const { json } = await detail('t1-owner');
    expect(json.ticket).toMatchObject({ subject: 'test', status: 'closed' });
    expect(json.account).toMatchObject({ kind: 'org', name: 'zz-test-907-about-food', role: 'owner' });
  });

  it('a visitor\'s ticket says "no account" and, if the e-mail is an account, which', async () => {
    expect((await detail('t5-visitor')).json.account).toMatchObject({ kind: 'none', matches: null });
    expect((await detail('t6-owner-by-email')).json.account).toMatchObject({ kind: 'none', matches: { kind: 'org', name: 'zz-test-907-about-food' } });
  });

  it('a missing ticket is still a 404', async () => {
    expect((await detail('nope')).status).toBe(404);
  });
});

describe('who may read it', () => {
  it('only a platform admin: anyone else gets a 403 and no tickets, no accounts', async () => {
    h.isAdmin = false;
    const list403 = await LIST(new Request('https://example.test/api/backoffice/support'));
    expect(list403.status).toBe(403);
    expect(JSON.stringify(await list403.json())).not.toContain('zz-test');
    const detail403 = await DETAIL(new Request('https://example.test/x'), { params: { id: 't1-owner' } });
    expect(detail403.status).toBe(403);
  });
});

describe('the resolver on its own', () => {
  it('handles a ticket whose org no longer exists, and a long list in pieces', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `bulk-${i}`, org_id: i === 0 ? 'deleted-org' : ORG_A, user_id: U_OWNER, email: 'x@y.z' }));
    const out = await resolveTicketAccounts(fakeAdmin(db), many);
    expect(out.get('bulk-0')).toMatchObject({ kind: 'org', id: 'deleted-org', name: null });
    expect(out.get('bulk-249')).toMatchObject({ kind: 'org', name: 'zz-test-907-about-food', role: 'owner' });
    expect(out.size).toBe(250);
  });

  it('answers nothing for no tickets and asks the database nothing', async () => {
    const before = (db.rpcCalls ?? []).length;
    expect((await resolveTicketAccounts(fakeAdmin(db), [])).size).toBe(0);
    expect((db.rpcCalls ?? []).length).toBe(before);
  });
});
