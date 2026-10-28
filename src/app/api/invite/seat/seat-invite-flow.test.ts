// Prompt 923 (B, C) — the whole path of a seat invitation through the REAL routes, the real seat rules and the stateful seat database (which also models the seat-limit trigger), with only the session, the mailer and
// the provider's email-code endpoint stubbed:
//   the administrator invites → the email carries the invitation's OWN link (never /login) → the page reads it → "Send me a code" goes to the INVITED address only → the code signs the person in →
//   a new account gives its name and role, an existing one joins at once → membership, profile, accepted invitation → they land in the firm's investor workspace.
// And the refusals: another address, a seat that is gone, an unknown or cancelled link; the invitation stays open and the administrator sees why. Also the messages of the code (wait N seconds, check the address, a reference).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  return { oneFirm: false };
});

let db: SeatDb;
let currentUser: { id: string; email: string; email_confirmed_at?: string; user_metadata?: Record<string, unknown> } | null;
const sent: { to: string; subject: string; html: string; text?: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSeatAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({ serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }) }));
vi.mock('@/lib/resend', () => ({
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text?: string }) => { sent.push(m); return { sent: true }; },
  transactionalTemplate: (o: { heading: string; body: string; ctaLabel?: string; ctaUrl?: string }) => `<h1>${o.heading}</h1><p>${o.body}</p><a href="${o.ctaUrl}">${o.ctaLabel}</a>`,
}));
vi.mock('@/lib/seat-invite-accept', async (orig) => { const m = await orig<typeof import('@/lib/seat-invite-accept')>(); return { ...m, get ONE_FIRM_PER_ACCOUNT() { return h.oneFirm; } }; });

import { GET as seatsGet } from '@/app/api/portal/seats/route';
import { POST as inviteCreate } from '@/app/api/portal/seats/invite/route';
import { POST as inviteCancel } from '@/app/api/portal/seats/invite/cancel/route';
import { POST as inviteResend } from '@/app/api/portal/seats/invite/resend/route';
import { GET as inviteGet } from './[token]/route';
import { POST as codePost } from './[token]/code/route';
import { GET as acceptGet, POST as acceptPost } from './[token]/accept/route';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { setSeatPlan } from '@/lib/investor-firm-seats';
import { areasOf, landingArea } from '@/lib/areas';
import { APP_URL } from '@/lib/brand';
import type { RoleSignals } from '@/lib/role-decision';

const FIRM = 'firm-qa'; const OTHER_FIRM = 'firm-pv';
const INVITED = 'sherlockdeal.com+aval2@gmail.com';
const json = (body?: unknown) => new Request('http://localhost/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const P = (token: string) => ({ params: { token } });
const as = (id: string | null) => { const u = id ? db.users.get(id) : null; currentUser = u ? { id: u.id, email: u.email, email_confirmed_at: '2026-10-28T10:00:00Z', user_metadata: u.user_metadata } : null; };
const seat = (userId: string, role = 'member', entity = FIRM) => { addUser(db, userId, `${userId}@qa.test`); db.tables.matchdeal_investor_members.push({ id: `m-${userId}-${entity}`, user_id: userId, catalog_entity_id: entity, status: 'active', role, created_at: `2026-01-0${db.tables.matchdeal_investor_members.length + 1}` }); };
const inviteRow = () => db.tables.investor_firm_seat_invites.find((i) => i.email === INVITED)!;
const tokenOf = () => inviteRow().token as string;
const linkOf = (email: { html: string }) => /href="([^"]+)"/.exec(email.html)?.[1] ?? '';
const members = (entity = FIRM) => db.tables.matchdeal_investor_members.filter((m) => m.catalog_entity_id === entity && m.status === 'active');
const seatsAsAdmin = async () => { as('ana'); return (await seatsGet()).json(); };

beforeEach(async () => {
  db = seatDb(); sent.length = 0; currentUser = null; h.oneFirm = false;
  db.tables.catalog_entities.push({ id: FIRM, name: 'ablute_ — Internal QA', website: 'https://qa.test' }, { id: OTHER_FIRM, name: 'Portugal Ventures', website: 'https://pv.test' });
  seat('ana', 'admin');
  await setSeatPlan(makeSeatStore(fakeSeatAdmin(db)), { entityId: FIRM, seats: 3, adminEmail: 'ana@qa.test', actor: 'bo' });
});

describe('the administrator invites: the email carries the invitation\'s own link', () => {
  it('the link is /invite/seat/<token> (64 hex), never /login; the invitation is Open on the administrator\'s list; the token is never in that list', async () => {
    as('ana');
    const r = await (await inviteCreate(json({ email: INVITED }))).json();
    expect(r).toEqual({ ok: true, emailSent: true });
    expect(tokenOf()).toMatch(/^[0-9a-f]{64}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(INVITED);
    expect(linkOf(sent[0])).toBe(`${APP_URL.replace(/\/$/, '')}/invite/seat/${tokenOf()}`);
    expect(sent[0].html).not.toContain('/login');
    expect(sent[0].html).not.toMatch(/claim its profile/i);
    const list = await seatsAsAdmin();
    expect(list.invites).toMatchObject([{ email: INVITED, state: 'open', label: 'Open', reason: null }]);
    expect(JSON.stringify(list)).not.toContain(tokenOf());
  });

  it('two invitations never share a token; "Send the link again" sends the SAME link, only for an administrator of THIS firm', async () => {
    as('ana');
    await inviteCreate(json({ email: INVITED })); await inviteCreate(json({ email: 'second@x.com' }));
    expect(new Set(db.tables.investor_firm_seat_invites.map((i) => i.token)).size).toBe(2);
    sent.length = 0;
    const id = inviteRow().id as string;
    expect(await (await inviteResend(json({ inviteId: id }))).json()).toEqual({ ok: true, emailSent: true });
    expect(linkOf(sent[0])).toContain(tokenOf());
    expect(db.tables.investor_seat_events.some((e) => e.event === 'invite_resent')).toBe(true);
    seat('bob', 'member'); as('bob');
    expect((await inviteResend(json({ inviteId: id }))).status).toBe(403);
    seat('eve', 'admin', OTHER_FIRM); as('eve');
    expect([403, 400, 404]).toContain((await inviteResend(json({ inviteId: id }))).status);
    as('ana');
    expect((await inviteResend(json({ inviteId: 'nope' }))).status).toBe(404);
  });
});

describe('the page reads the invitation, and asks for the code for the invited address only', () => {
  beforeEach(async () => { as('ana'); await inviteCreate(json({ email: INVITED })); sent.length = 0; as(null); });

  it('the public read gives the firm and the invited address and nothing about accounts; an unknown or malformed token is a bare 404', async () => {
    expect(await (await inviteGet(new Request('http://localhost/x'), P(tokenOf()))).json()).toEqual({ ok: true, firmName: 'ablute_ — Internal QA', email: INVITED, status: 'open' });
    for (const bad of ['nope', 'x'.repeat(64), '../etc', '']) expect((await inviteGet(new Request('http://localhost/x'), P(bad))).status).toBe(404);
  });

  it('"Send me a code" goes to the INVITED address only — the browser sends no address — and creates the account when there is none', async () => {
    const r = await codePost(json({ email: 'attacker@evil.com' }), P(tokenOf()));
    expect(await r.json()).toEqual({ ok: true, message: `We sent a 6-digit code to ${INVITED}.` });
    expect(db.otp!.requests).toEqual([{ email: INVITED, shouldCreateUser: true }]);
    expect([...db.users.values()].some((u) => u.email === 'attacker@evil.com')).toBe(false);
    expect([...db.users.values()].some((u) => u.email === INVITED)).toBe(true);
  });

  it('a cancelled invitation asks for no code (410) and says whom to ask; an unknown one is a 404', async () => {
    as('ana'); await inviteCancel(json({ inviteId: inviteRow().id })); as(null);
    const r = await codePost(json({}), P(tokenOf()));
    expect(r.status).toBe(410);
    expect((await r.json()).error).toBe('This invitation was cancelled. Ask ablute_ — Internal QA to send you a new one.');
    expect((await codePost(json({}), P('nope'))).status).toBe(404);
    expect(db.otp?.requests ?? []).toEqual([]);
  });

  it('C — two codes in a row: the provider\'s 429 becomes "For security, wait 219 seconds before asking for a new code." with the number the page counts down', async () => {
    db.otp = { requests: [], fail: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 219 seconds.' } };
    const r = await codePost(json({}), P(tokenOf()));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ ok: false, code: 'rate_limited', retryAfterSeconds: 219, error: 'For security, wait 219 seconds before asking for a new code.' });
  });

  it('C — an address that can never work never reaches the provider: "Check the email address — it looks incomplete." (the 28/10 "…@gmail.c")', async () => {
    const token = tokenOf();
    inviteRow().email = 'sherlockdeal.com+aval1@gmail.c';
    const r = await codePost(json({}), P(token));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, code: 'invalid_email', error: 'Check the email address — it looks incomplete.' });
    expect(db.otp?.requests ?? []).toEqual([]);
  });

  it('C — a failure nobody can fix: "Something went wrong. Try again in a minute." with a reference, never the provider\'s text', async () => {
    db.otp = { requests: [], fail: { status: 418, message: 'raw provider text nobody should read' } };
    const r = await codePost(json({}), P(tokenOf()));
    const body = await r.json();
    expect(r.status).toBe(502);
    expect(body.error).toMatch(/^Something went wrong\. Try again in a minute\. \(ref [A-HJ-NP-Z2-9]{6}\)$/);
    expect(body.error).not.toContain('raw provider text');
    expect(body.ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('THE WHOLE PATH with a new account (the +aval2 path, B.5)', () => {
  it('invite → email → page → code → name and role → member of the firm → lands in the firm\'s investor workspace; the administrator sees Accepted', async () => {
    // 1. the administrator invites
    as('ana');
    expect((await (await inviteCreate(json({ email: INVITED }))).json()).ok).toBe(true);
    const link = linkOf(sent[0]); const token = link.split('/').pop()!;
    // 2. the person opens the link in a window with no session: the page reads the invitation
    as(null);
    const page = await (await inviteGet(new Request('http://localhost/x'), P(token))).json();
    expect(page).toMatchObject({ firmName: 'ablute_ — Internal QA', email: INVITED, status: 'open' });
    // 3. "Send me a code": the account is created by the provider for the invited address
    expect((await codePost(json(), P(token))).status).toBe(200);
    const created = [...db.users.values()].find((u) => u.email === INVITED)!;
    expect(created).toBeTruthy();
    // 4. the code signs them in (the browser verifies it with the provider); the page asks the server what is left
    as(created.id);
    expect(await (await acceptGet(new Request('http://localhost/x'), P(token))).json()).toEqual({ ok: true, signedInAs: INVITED, matches: true, needsProfile: true });
    // 5. without a name and a role the server asks for them; nothing is spent
    const early = await acceptPost(json({}), P(token));
    expect(early.status).toBe(422);
    expect((await early.json()).code).toBe('profile_required');
    expect(inviteRow().status).toBe('open');
    // 6. with them: member of the firm, profile, name and role on the account, invitation accepted
    const done = await acceptPost(json({ name: 'Aval Two', role: 'Analyst' }), P(token));
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, firmName: 'ablute_ — Internal QA', alreadyAccepted: false, next: '/go?as=investor' });
    expect(members().map((m) => m.user_id).sort()).toEqual(['ana', created.id].sort());
    expect(db.tables.matchdeal_investor_members.find((m) => m.user_id === created.id)).toMatchObject({ status: 'active', role: 'member', catalog_entity_id: FIRM });
    expect(db.tables.matchdeal_profiles.find((p) => p.kind === 'investor' && p.representative_name === 'Aval Two')).toBeTruthy();
    expect(db.users.get(created.id)!.user_metadata).toMatchObject({ full_name: 'Aval Two', job_title: 'Analyst' });
    expect(inviteRow()).toMatchObject({ status: 'accepted', accepted_user_id: created.id, failure_reason: null });
    expect(db.tables.investor_seat_events.map((e) => e.event)).toEqual(expect.arrayContaining(['invite_created', 'seat_granted', 'invite_accepted']));
    // 7. /go sends them to the FIRM's workspace — never to a founder registration, never to an empty data room
    const signals: RoleSignals = { isPlatformAdmin: false, hasOpenFounderOrg: false, hasActiveIncubatorMembership: false, hasApprovedClaim: false, hasActiveInvestorMembership: members().some((m) => m.user_id === created.id), hasAccessGrant: false, isAbluteTeamEmailConfirmed: false, hasPendingClaim: false };
    expect(landingArea(areasOf(signals), { intent: 'investor' })).toBe('investor');
    // 8. the same page opened again is fine; the administrator's list says Accepted
    expect(await (await acceptPost(json({}), P(token))).json()).toMatchObject({ ok: true, alreadyAccepted: true });
    expect(members()).toHaveLength(2);                                                          // no second seat
    const list = await seatsAsAdmin();
    expect(list.invites).toEqual([]);
    expect(list.acceptedInvites).toMatchObject([{ email: INVITED, state: 'accepted', label: 'Accepted' }]);
    expect(list.members.map((m: { name: string | null }) => m.name)).toContain('Aval Two');
  });
});

describe('an account that already exists', () => {
  beforeEach(async () => { as('ana'); await inviteCreate(json({ email: INVITED })); sent.length = 0; });

  it('without a firm, with its name and role known: joins at once, nothing more is asked', async () => {
    db.users.set('old-1', { id: 'old-1', email: INVITED, user_metadata: { full_name: 'Existing Person', job_title: 'Partner' } });
    as('old-1');
    expect(await (await acceptGet(new Request('http://localhost/x'), P(tokenOf()))).json()).toMatchObject({ matches: true, needsProfile: false });
    expect(await (await acceptPost(json({}), P(tokenOf()))).json()).toMatchObject({ ok: true, firmName: 'ablute_ — Internal QA' });
    expect(members().some((m) => m.user_id === 'old-1')).toBe(true);
    expect(inviteRow().status).toBe('accepted');
  });

  it('THE RULE TODAY: an account that already belongs to another firm joins this one as well (an account may belong to several firms)', async () => {
    db.users.set('old-2', { id: 'old-2', email: INVITED, user_metadata: { full_name: 'Two Firms', job_title: 'Partner' } });
    db.tables.matchdeal_investor_members.push({ id: 'm-old-2-pv', user_id: 'old-2', catalog_entity_id: OTHER_FIRM, status: 'active', role: 'member', created_at: '2026-02-01' });
    as('old-2');
    expect((await acceptPost(json({}), P(tokenOf()))).status).toBe(200);
    expect(db.tables.matchdeal_investor_members.filter((m) => m.user_id === 'old-2' && m.status === 'active').map((m) => m.catalog_entity_id).sort()).toEqual([FIRM, OTHER_FIRM].sort());
  });

  it('WITH THE ONE-FIRM RULE ON: refused with "This account already belongs to «Portugal Ventures»…", the invitation stays open, and the administrator sees "Couldn\'t be accepted" with that reason', async () => {
    h.oneFirm = true;
    db.users.set('old-2', { id: 'old-2', email: INVITED, user_metadata: { full_name: 'Two Firms', job_title: 'Partner' } });
    db.tables.matchdeal_investor_members.push({ id: 'm-old-2-pv', user_id: 'old-2', catalog_entity_id: OTHER_FIRM, status: 'active', role: 'member', created_at: '2026-02-01' });
    as('old-2');
    const r = await acceptPost(json({}), P(tokenOf()));
    expect(r.status).toBe(409);
    const sentence = 'This account already belongs to «Portugal Ventures». Ask the inviter to use a different email, or leave «Portugal Ventures» first.';
    expect(await r.json()).toEqual({ ok: false, code: 'other_firm', error: sentence });
    expect(members().some((m) => m.user_id === 'old-2')).toBe(false);
    expect(inviteRow()).toMatchObject({ status: 'open', failure_reason: sentence });
    const list = await seatsAsAdmin();
    expect(list.invites).toMatchObject([{ email: INVITED, state: 'failed', label: "Couldn't be accepted", reason: sentence }]);
    expect(db.tables.investor_seat_events.some((e) => e.event === 'invite_failed')).toBe(true);
  });

  it('signed in as ANOTHER address: the page is told, with the invited address masked; nothing is joined or spent', async () => {
    seat('bob', 'member');
    as('bob');
    expect(await (await acceptGet(new Request('http://localhost/x'), P(tokenOf()))).json()).toMatchObject({ ok: true, matches: false, signedInAs: 'bob@qa.test' });
    const r = await acceptPost(json({ name: 'Bob', role: 'x' }), P(tokenOf()));
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.code).toBe('wrong_account');
    expect(body.error).not.toContain('sherlockdeal.com+aval2');
    expect(body.error).toContain('@gmail.com');
    expect(inviteRow().status).toBe('open');
  });

  it('signed out: the accept routes ask for the code first (401); the public page is unaffected', async () => {
    as(null);
    expect((await acceptGet(new Request('http://localhost/x'), P(tokenOf()))).status).toBe(401);
    expect((await acceptPost(json({}), P(tokenOf()))).status).toBe(401);
  });
});

describe('when the firm cannot take the person (the invitation is NOT spent)', () => {
  it('the seat is gone: the page says so, the administrator sees "Couldn\'t be accepted" and why, and after the plan grows the same link works', async () => {
    as('ana'); await inviteCreate(json({ email: INVITED }));
    db.users.set('old-1', { id: 'old-1', email: INVITED, user_metadata: { full_name: 'X', job_title: 'Y' } });
    // the plan is cut to the seats already taken: the reserved seat disappears with it
    await setSeatPlan(makeSeatStore(fakeSeatAdmin(db)), { entityId: FIRM, seats: 1, adminEmail: 'ana@qa.test', actor: 'bo' }).catch(() => null);
    db.tables.investor_firm_seat_plans.forEach((p) => { if (p.catalog_entity_id === FIRM) p.seats = 1; });
    as('old-1');
    const r = await acceptPost(json({}), P(tokenOf()));
    expect(r.status).toBe(409);
    const refused = await r.json();
    expect(refused.code).toBe('seat_refused');
    expect(refused.error).toBeTruthy();
    expect(members().some((m) => m.user_id === 'old-1')).toBe(false);
    expect(inviteRow()).toMatchObject({ status: 'open', failure_reason: refused.error });
    expect((await seatsAsAdmin()).invites[0]).toMatchObject({ state: 'failed', label: "Couldn't be accepted", reason: refused.error });
    db.tables.investor_firm_seat_plans.forEach((p) => { if (p.catalog_entity_id === FIRM) p.seats = 3; });
    as('old-1');
    expect((await acceptPost(json({}), P(tokenOf()))).status).toBe(200);
    expect(inviteRow()).toMatchObject({ status: 'accepted', failure_reason: null });
  });

  it('a firm whose plan ended: "This firm no longer has a seat plan…"; the invitation stays open', async () => {
    as('ana'); await inviteCreate(json({ email: INVITED }));
    db.tables.investor_firm_seat_plans.length = 0;
    db.users.set('old-1', { id: 'old-1', email: INVITED, user_metadata: { full_name: 'X', job_title: 'Y' } });
    as('old-1');
    const r = await acceptPost(json({}), P(tokenOf()));
    expect(await r.json()).toMatchObject({ code: 'seat_refused', error: 'This firm no longer has a seat plan. Ask the inviter to send you a new invitation.' });
    expect(inviteRow().status).toBe('open');
  });

  it('a cancelled invitation cannot be accepted even by the right person (410)', async () => {
    as('ana'); await inviteCreate(json({ email: INVITED })); await inviteCancel(json({ inviteId: inviteRow().id }));
    db.users.set('old-1', { id: 'old-1', email: INVITED, user_metadata: { full_name: 'X', job_title: 'Y' } });
    as('old-1');
    const r = await acceptPost(json({}), P(tokenOf()));
    expect(r.status).toBe(410);
    expect((await r.json()).code).toBe('cancelled');
    expect(members().some((m) => m.user_id === 'old-1')).toBe(false);
  });
});
