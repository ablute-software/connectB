// Prompt 907 §A — the back-office Ficha do cliente shows the people attached to the account, through the REAL route handler
// over an in-memory database (the way the Calls back-office route is tested): platform admin only; for a startup the
// org_members with the facts that live on auth.users, and the invitations still pending; for a VC firm the active seats and
// the open seat invitations; never another customer's people, never an invitation token.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { fakeAdmin, fakeDb, type FakeDb } from '@/test/fake-supabase';

const h = vi.hoisted(() => ({ isAdmin: true, admin: null as unknown }));
vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (h.isAdmin
    ? { admin: h.admin, userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));

import { GET } from '@/app/api/backoffice/ficha-cliente/[kind]/[id]/route';
import { loadOrgPeople } from '@/lib/backoffice-customer-people';

const ORG = 'a7a7a7a7-0000-4000-8000-000000000907'; // zz-test-907-founders
const OTHER_ORG = 'b7b7b7b7-0000-4000-8000-000000000907'; // zz-test-907-other
const FIRM = 'c7c7c7c7-0000-4000-8000-000000000907'; // zz-test-907-capital
const U_OWNER = 'u-owner'; const U_MEMBER = 'u-member'; const U_OTHER = 'u-other';
const U_SEAT_OWNER = 'u-seat-owner'; const U_SEAT_MEMBER = 'u-seat-member'; const U_SEAT_GONE = 'u-seat-gone';
const NOW = Date.parse('2026-10-13T12:00:00Z');

let db: FakeDb;

function world(): FakeDb {
  const d = fakeDb({
    orgs: [
      { id: ORG, name: 'zz-test-907-founders', plan: 'idea', created_at: '2026-09-01T09:00:00Z', description: 'zz-test' },
      { id: OTHER_ORG, name: 'zz-test-907-other', plan: 'idea', created_at: '2026-09-02T09:00:00Z' },
    ],
    org_members: [
      { org_id: ORG, user_id: U_MEMBER, role: 'member' },
      { org_id: ORG, user_id: U_OWNER, role: 'owner' },
      { org_id: OTHER_ORG, user_id: U_OTHER, role: 'owner' },
    ],
    org_invitations: [
      // the member's own invitation, accepted → that is when they joined
      { id: 'inv-accepted', org_id: ORG, email: 'Member@zz-test-907.example', role: 'member', token: 'secret-token-accepted', status: 'accepted', invited_by: U_OWNER, created_at: '2026-09-20T08:00:00Z', expires_at: '2026-09-27T08:00:00Z', accepted_at: '2026-09-22T10:30:00Z' },
      // the one pending, still valid
      { id: 'inv-pending', org_id: ORG, email: 'pending@zz-test-907.example', role: 'admin', token: 'secret-token-pending', status: 'pending', invited_by: U_OWNER, created_at: '2026-10-10T08:00:00Z', expires_at: '2026-10-17T08:00:00Z', accepted_at: null },
      // pending in the table, but its date has passed
      { id: 'inv-lapsed', org_id: ORG, email: 'lapsed@zz-test-907.example', role: 'member', token: 'secret-token-lapsed', status: 'pending', invited_by: U_OWNER, created_at: '2026-09-01T08:00:00Z', expires_at: '2026-09-08T08:00:00Z', accepted_at: null },
      // revoked: not pending
      { id: 'inv-revoked', org_id: ORG, email: 'revoked@zz-test-907.example', role: 'member', token: 'secret-token-revoked', status: 'revoked', invited_by: U_OWNER, created_at: '2026-10-01T08:00:00Z', expires_at: '2026-10-08T08:00:00Z', accepted_at: null },
      // another customer's pending invitation
      { id: 'inv-other', org_id: OTHER_ORG, email: 'someone@elsewhere.example', role: 'member', token: 'secret-token-other', status: 'pending', invited_by: U_OTHER, created_at: '2026-10-11T08:00:00Z', expires_at: '2026-10-18T08:00:00Z', accepted_at: null },
    ],
    catalog_entities: [{ id: FIRM, name: 'zz-test-907-capital', thesis: 'zz-test thesis', notes: null }],
    matchdeal_investor_members: [
      { id: 'm1', user_id: U_SEAT_OWNER, catalog_entity_id: FIRM, status: 'active', role: 'owner', created_at: '2026-08-15T09:00:00Z' },
      { id: 'm2', user_id: U_SEAT_MEMBER, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-09-30T09:00:00Z' },
      { id: 'm3', user_id: U_SEAT_GONE, catalog_entity_id: FIRM, status: 'revoked', role: 'member', created_at: '2026-08-20T09:00:00Z' },
    ],
    investor_firm_seat_invites: [
      { id: 'si-open', catalog_entity_id: FIRM, email: 'invited@capital.example', status: 'open', invited_by: null, accepted_user_id: null, accepted_at: null, created_at: '2026-10-09T09:00:00Z' },
      { id: 'si-cancelled', catalog_entity_id: FIRM, email: 'cancelled@capital.example', status: 'cancelled', invited_by: null, accepted_user_id: null, accepted_at: null, created_at: '2026-10-01T09:00:00Z' },
      { id: 'si-accepted', catalog_entity_id: FIRM, email: 'u-seat-member@capital.example', status: 'accepted', invited_by: null, accepted_user_id: U_SEAT_MEMBER, accepted_at: '2026-09-30T09:00:00Z', created_at: '2026-09-29T09:00:00Z' },
    ],
    investor_billing: [],
    billing_invoices: [],
    promo_redemptions: [],
    promo_outreach_targets: [],
  });
  d.authUsers = {
    [U_OWNER]: { email: 'owner@zz-test-907.example', email_confirmed_at: '2026-09-01T09:05:00Z', last_sign_in_at: '2026-10-12T09:00:00Z', created_at: '2026-09-01T09:00:00Z' },
    [U_MEMBER]: { email: 'member@zz-test-907.example', email_confirmed_at: null, last_sign_in_at: null, created_at: '2026-09-22T10:00:00Z' },
    [U_OTHER]: { email: 'other-owner@elsewhere.example', email_confirmed_at: '2026-09-02T09:05:00Z', last_sign_in_at: '2026-10-11T09:00:00Z', created_at: '2026-09-02T09:00:00Z' },
    [U_SEAT_OWNER]: { email: 'partner@capital.example', email_confirmed_at: '2026-08-15T09:10:00Z', last_sign_in_at: '2026-10-13T08:00:00Z', created_at: '2026-08-15T09:00:00Z' },
    [U_SEAT_MEMBER]: { email: 'associate@capital.example', email_confirmed_at: '2026-09-30T09:10:00Z', last_sign_in_at: null, created_at: '2026-09-30T09:00:00Z' },
    [U_SEAT_GONE]: { email: 'gone@capital.example', email_confirmed_at: '2026-08-20T09:10:00Z', last_sign_in_at: '2026-09-01T09:00:00Z', created_at: '2026-08-20T09:00:00Z' },
  };
  return d;
}

async function ficha(kind: string, id: string) {
  const res = await GET(new Request('https://example.test/x'), { params: Promise.resolve({ kind, id }) });
  return { status: res.status, json: await res.json() as { ok: boolean; customer?: Record<string, unknown> } };
}

beforeEach(() => {
  db = world();
  h.admin = fakeAdmin(db);
  h.isAdmin = true;
});

describe('a startup (kind = org)', () => {
  it('lists its members — owner first — with the facts that live on auth.users', async () => {
    const { status, json } = await ficha('org', ORG);
    expect(status).toBe(200);
    const members = json.customer?.members as Record<string, unknown>[];
    expect(members.map((m) => m.email)).toEqual(['owner@zz-test-907.example', 'member@zz-test-907.example']);
    expect(members[0]).toMatchObject({ userId: U_OWNER, role: 'owner', emailConfirmed: true, lastSignInAt: '2026-10-12T09:00:00Z' });
    expect(members[1]).toMatchObject({ userId: U_MEMBER, role: 'member', emailConfirmed: false, lastSignInAt: null });
  });

  it('says when each joined, and where that date comes from: the accepted invitation, else the account itself', async () => {
    const members = (await ficha('org', ORG)).json.customer?.members as Record<string, unknown>[];
    // the founder has no invitation: the day the account was created (org_members has no joined date of its own)
    expect(members[0]).toMatchObject({ joinedAt: '2026-09-01T09:00:00Z', joinedSource: 'account' });
    // the invited teammate: the day the invitation was accepted (matched on e-mail, whatever its case)
    expect(members[1]).toMatchObject({ joinedAt: '2026-09-22T10:30:00Z', joinedSource: 'invitation' });
  });

  it('lists only the PENDING invitations, newest first, and marks the one whose date has passed', async () => {
    // The fixture dates are fixed (the pending invitation expires on 17 Oct 2026), so the clock is fixed too: this test failed for real the day after, on 19/10/2026.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    try {
    const invites = (await ficha('org', ORG)).json.customer?.invites as Record<string, unknown>[];
    expect(invites.map((i) => i.id)).toEqual(['inv-pending', 'inv-lapsed']);
    expect(invites[0]).toMatchObject({ email: 'pending@zz-test-907.example', role: 'admin', sentAt: '2026-10-10T08:00:00Z', expiresAt: '2026-10-17T08:00:00Z' });
    expect(invites[0].expired).toBe(false);
    expect(invites[1].expired).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('never carries an invitation token, nor another customer\'s people', async () => {
    const body = JSON.stringify((await ficha('org', ORG)).json);
    expect(body).not.toMatch(/secret-token/);
    expect(body).not.toContain('"token"');
    expect(body).not.toContain('other-owner@elsewhere.example');
    expect(body).not.toContain('someone@elsewhere.example');
    expect(body).not.toContain('capital.example');
  });

  it('keeps showing what the page showed before (plan, signup date, invoices)', async () => {
    const c = (await ficha('org', ORG)).json.customer as Record<string, unknown>;
    expect(c).toMatchObject({ kind: 'org', id: ORG, name: 'zz-test-907-founders' });
    expect(c.signupDate).toBe('2026-09-01T09:00:00Z');
    expect(Array.isArray(c.invoices)).toBe(true);
  });

  it('a member whose auth user is gone still shows up, as "(unknown)", rather than being dropped', async () => {
    delete db.authUsers![U_MEMBER];
    const members = (await ficha('org', ORG)).json.customer?.members as Record<string, unknown>[];
    expect(members.map((m) => m.email)).toContain('(unknown)');
    expect(members).toHaveLength(2);
  });

  it('a startup with nobody attached has an empty roster, not an error', async () => {
    db.tables.org_members = db.tables.org_members.filter((m) => m.org_id !== ORG);
    const c = (await ficha('org', ORG)).json.customer as Record<string, unknown>;
    expect(c.members).toEqual([]);
  });

  it('works through the library too, with a clock that decides what has expired', async () => {
    const people = await loadOrgPeople(fakeAdmin(db), ORG, Date.parse('2026-09-05T00:00:00Z'));
    expect(people.invites.find((i) => i.id === 'inv-lapsed')?.expired).toBe(false); // not yet, on 5 September
    const later = await loadOrgPeople(fakeAdmin(db), ORG, NOW);
    expect(later.invites.find((i) => i.id === 'inv-lapsed')?.expired).toBe(true);
  });
});

describe('a VC firm (kind = investor_entity)', () => {
  it('lists its ACTIVE seats, with the day the seat was created, and not the revoked one', async () => {
    const { json } = await ficha('investor_entity', FIRM);
    const members = json.customer?.members as Record<string, unknown>[];
    expect(members.map((m) => m.email)).toEqual(['partner@capital.example', 'associate@capital.example']);
    expect(members[0]).toMatchObject({ role: 'owner', joinedAt: '2026-08-15T09:00:00Z', joinedSource: 'seat', emailConfirmed: true, lastSignInAt: '2026-10-13T08:00:00Z' });
    expect(members[1]).toMatchObject({ role: 'member', emailConfirmed: true, lastSignInAt: null });
    expect(JSON.stringify(members)).not.toContain('gone@capital.example');
  });

  it('lists the OPEN seat invitations only (not cancelled, not accepted)', async () => {
    const invites = (await ficha('investor_entity', FIRM)).json.customer?.invites as Record<string, unknown>[];
    expect(invites).toEqual([{ id: 'si-open', email: 'invited@capital.example', role: null, sentAt: '2026-10-09T09:00:00Z', expiresAt: null, expired: false }]);
  });

  it('never carries another customer\'s people', async () => {
    const body = JSON.stringify((await ficha('investor_entity', FIRM)).json);
    expect(body).not.toContain('zz-test-907.example');
    expect(body).not.toContain('elsewhere.example');
  });
});

describe('who may read it', () => {
  it('only a platform admin: anyone else gets a 403 and nothing about anybody', async () => {
    h.isAdmin = false;
    const { status, json } = await ficha('org', ORG);
    expect(status).toBe(403);
    expect(JSON.stringify(json)).not.toContain('@');
  });

  it('refuses an unknown kind, and an id that is no customer', async () => {
    expect((await ficha('startup', ORG)).status).toBe(400);
    expect((await ficha('org', 'no-such-org')).status).toBe(404);
  });
});
