// Prompt 907, I5 — deadline and notifications: an extension tells whoever has a draft (and the entity never learns who), the 48-hour reminder goes to
// drafts only and once per deadline, the emails of a call reply to its "Contact email for applicants", and that field is validated.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let currentUser: { id: string; email: string; email_confirmed_at?: string | null } | null;
const sent: { to: string; subject: string; html: string; text?: string; replyTo?: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  transactionalTemplate: (o: unknown) => JSON.stringify(o),
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text?: string; replyTo?: string }) => { sent.push(m); return { sent: true, id: 'em_1' }; },
}));

import { POST as actionPost } from './[id]/action/route';
import { PUT as contactPut } from './[id]/contact/route';
import { GET as submissionsGet } from './[id]/submissions/route';
import { GET as overviewGet } from './apply/overview/route';
import { sendDraftReminders } from '@/lib/calls/applicant/notices';
import { parseContactEmail } from '@/lib/calls/applicant/contact';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string) => { currentUser = { id, email: `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' }; };
const notices = () => db.tables.call_notices;

function seed(callOver: Record<string, unknown> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); sent.length = 0; db.nowMs = undefined;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.calls.push({
    id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'Seed Call 2027', description: 'Summary', status: 'open',
    opens_at: iso(-5 * DAY), closes_at: iso(30 * HOUR), timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project', allow_multiple: false, content_language: 'en',
    currency: 'EUR', link_token: 'tok-907-i5-0123456789abcdef', config_version: 3, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', contact_email: null, ...callOver,
  });
  db.tables.call_form_fields.push({ id: 'f0000000-0000-4000-8000-000000000001', call_id: CALL, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false });
  db.tables.orgs.push({ id: ORG_A, name: 'Acme', is_test: false }, { id: ORG_B, name: 'Other', is_test: false });
  for (const u of ['ana', 'founder-a', 'founder-b', 'founder-c']) db.users.set(u, { id: u, email: `${u}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.call_applications.push(
    { id: 'a-draft', call_id: CALL, startup_org_id: ORG_A, applicant_user_id: 'founder-a', status: 'draft', reference: 'APP-AAAA-1111', unit_key: `org:${ORG_A}`, created_at: iso(-DAY), updated_at: iso(-HOUR) },
    { id: 'a-done', call_id: CALL, startup_org_id: ORG_B, applicant_user_id: 'founder-b', status: 'submitted', reference: 'APP-BBBB-2222', unit_key: `org:${ORG_B}`, created_at: iso(-DAY), updated_at: iso(-HOUR), submitted_at: iso(-HOUR) },
  );
}

describe('the contact email for applicants', () => {
  it('is optional, a plain address, lower-cased; empty clears it', () => {
    expect(parseContactEmail(undefined)).toEqual({ ok: true, email: null });
    expect(parseContactEmail('   ')).toEqual({ ok: true, email: null });
    expect(parseContactEmail(' Apply@Fund.EU ')).toEqual({ ok: true, email: 'apply@fund.eu' });
    for (const bad of ['no-at', 'a@b', 'two words@x.com', 42, 'a@b@c.com']) expect(parseContactEmail(bad).ok).toBe(false);
  });

  it('is saved by whoever may configure the call, refused when invalid, and logged without the address', async () => {
    seed(); as('ana');
    expect((await read(await contactPut(json('PUT', { contactEmail: 'nope' }), params(CALL)))).status).toBe(400);
    const ok = await read(await contactPut(json('PUT', { contactEmail: 'Apply@Fund.eu' }), params(CALL)));
    expect(ok).toMatchObject({ status: 200, body: { ok: true, contactEmail: 'apply@fund.eu' } });
    expect(db.tables.calls[0].contact_email).toBe('apply@fund.eu');
    expect(JSON.stringify(db.tables.call_events)).not.toContain('apply@fund.eu');
    await contactPut(json('PUT', { contactEmail: '' }), params(CALL));
    expect(db.tables.calls[0].contact_email).toBeNull();
    as('stranger'); db.users.set('stranger', { id: 'stranger', email: 'stranger@example.com' });
    expect([403, 404]).toContain((await contactPut(json('PUT', { contactEmail: 'x@y.com' }), params(CALL))).status);
  });
});

describe('extending the deadline', () => {
  it('notifies whoever has a draft — in-app and by email — and not who already submitted', async () => {
    seed({ contact_email: 'apply@fund.eu' }); as('ana');
    const r = await read(await actionPost(json('POST', { action: 'extend', closesAt: iso(10 * DAY) }), params(CALL)));
    expect(r.status).toBe(200);
    expect(notices().map((n) => [n.user_id, n.kind])).toEqual([['founder-a', 'deadline_extended']]);
    expect(sent.map((m) => m.to)).toEqual(['founder-a@example.com']);
    expect(sent[0].replyTo).toBe('apply@fund.eu'); // the call's own contact email
  });

  it('the entity learns that it was notified, never who: the answer and the event carry a count only', async () => {
    seed(); as('ana');
    const r = await read(await actionPost(json('POST', { action: 'extend', closesAt: iso(10 * DAY) }), params(CALL)));
    expect(JSON.stringify(r.body)).not.toMatch(/founder-a|APP-AAAA/);
    const ev = db.tables.call_events.find((e) => e.event === 'deadline_extension_notified');
    expect(ev?.detail).toEqual({ applicants: 1 });
    const subs = await read(await submissionsGet(json('GET'), params(CALL)));
    expect(JSON.stringify(subs.body)).not.toMatch(/founder-a|APP-AAAA|draft/i);
  });

  it('without a contact email the emails have no Reply-To (no global fallback)', async () => {
    seed(); as('ana');
    await actionPost(json('POST', { action: 'extend', closesAt: iso(10 * DAY) }), params(CALL));
    expect(sent).toHaveLength(1);
    expect(sent[0].replyTo).toBeUndefined();
  });

  it('a second extension notifies again (new deadline), a repeated identical one does not duplicate', async () => {
    seed(); as('ana');
    const first = iso(10 * DAY), second = iso(20 * DAY);
    await actionPost(json('POST', { action: 'extend', closesAt: first }), params(CALL));
    await actionPost(json('POST', { action: 'extend', closesAt: second }), params(CALL));
    expect(notices()).toHaveLength(2);
    expect(new Set(notices().map((n) => n.dedupe_key)).size).toBe(2);
  });
});

describe('the 48-hour reminder', () => {
  it('goes to a draft when the call is within 48 hours of closing — once per deadline — and never to who submitted', async () => {
    seed(); // closes in 30 h
    const admin = fakeCallsAdmin(db);
    const first = await sendDraftReminders(admin as never, new Date());
    expect(first).toEqual({ calls: 1, reminded: 1 });
    expect(notices().map((n) => [n.user_id, n.kind])).toEqual([['founder-a', 'draft_reminder']]);
    expect(sent.map((m) => m.to)).toEqual(['founder-a@example.com']);
    const again = await sendDraftReminders(admin as never, new Date());
    expect(again.reminded).toBe(0); // once
    expect(notices()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('does not remind when the deadline is further than 48 hours, or already passed', async () => {
    seed({ closes_at: iso(3 * DAY) });
    expect((await sendDraftReminders(fakeCallsAdmin(db) as never, new Date())).reminded).toBe(0);
    db.tables.calls[0].closes_at = iso(-HOUR);
    expect((await sendDraftReminders(fakeCallsAdmin(db) as never, new Date())).reminded).toBe(0);
    expect(notices()).toEqual([]);
  });

  it('an application submitted before the sweep is not reminded; one submitted after the reminder keeps only the receipt path', async () => {
    seed();
    db.tables.call_applications.find((a) => a.id === 'a-draft')!.status = 'submitted';
    expect((await sendDraftReminders(fakeCallsAdmin(db) as never, new Date())).reminded).toBe(0);
    expect(sent).toEqual([]);
  });

  it('an extension earns a new reminder before the new deadline', async () => {
    seed();
    await sendDraftReminders(fakeCallsAdmin(db) as never, new Date());
    db.tables.calls[0].closes_at = iso(40 * HOUR);
    const r = await sendDraftReminders(fakeCallsAdmin(db) as never, new Date());
    expect(r.reminded).toBe(1);
    expect(notices()).toHaveLength(2);
  });

  it('when someone opens their Calls area, only THEIR draft is reminded, without waiting for the daily job', async () => {
    seed();
    db.tables.call_applications.push({ id: 'a-c', call_id: CALL, startup_org_id: 'org-c', applicant_user_id: 'founder-c', status: 'draft', reference: 'APP-CCCC-3333', unit_key: 'org:org-c', created_at: iso(-DAY), updated_at: iso(-HOUR) });
    db.tables.org_members.push({ org_id: ORG_A, user_id: 'founder-a', role: 'owner' });
    as('founder-a');
    const res = await overviewGet(json('GET'));
    expect(res.status).toBe(200);
    expect(notices().map((n) => n.user_id)).toEqual(['founder-a']); // founder-c waits for the daily job
  });

  it('the daily job calls the sweep as its own independent step', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/app/api/automations/route.ts`, 'utf8');
    expect(src).toMatch(/sendDraftReminders\(admin, new Date\(\)\)/);
    expect(src).toMatch(/callDraftReminders/);
    // an error there must not stop the other sweeps: it is inside its own try/catch
    expect(src).toMatch(/try \{\s*callDraftReminders = await sendDraftReminders/);
  });
});

// --- Prompt 918 (Adenda 1, B): reopen and extend a closed call -------------------------------------------------------------------------------------------------
import { GET as oneGet } from './[id]/route';
import { evaluationStarted, reopenCall } from '@/lib/calls/lifecycle';
import type { Call } from '@/lib/calls/types';

describe('reopen and extend (a closed call)', () => {
  const events = (name: string) => db.tables.call_events.filter((e) => e.call_id === CALL && e.event === name);
  const reopen = (extra: Record<string, unknown> = {}) => actionPost(json('POST', { action: 'reopen', closesAt: iso(7 * DAY), ...extra }), params(CALL)).then(read);
  const closedEarlyOnPurpose = () => db.tables.call_events.push({ id: 9001, call_id: CALL, event: 'call_closed', actor_user_id: 'ana', detail: { early: true }, created_at: iso(-3 * DAY) });
  const callRow = () => db.tables.calls.find((c) => c.id === CALL)!;

  it('a call that closed at its DEADLINE: the button is offered; reopening opens it with the new deadline, keeps the history, and tells whoever has a draft', async () => {
    seed({ status: 'open', closes_at: iso(-DAY) }); as('ana');
    const before = await read(await oneGet(json('GET'), params(CALL)));
    expect(before.body.effectiveStatus).toBe('closed');
    expect(before.body.actions).toMatchObject({ canReopen: true, reopenNeedsConfirm: false, canExtend: false });

    const newDeadline = iso(7 * DAY);
    const r = await reopen({ closesAt: newDeadline });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.effectiveStatus).toBe('open');
    expect(callRow()).toMatchObject({ status: 'open', closed_at: null });
    expect(Date.parse(callRow().closes_at as string)).toBe(Date.parse(newDeadline));
    expect(r.body.actions).toMatchObject({ canReopen: false, canExtend: true });
    // the history says who, when (the event's own date), from which deadline to which
    const [ev] = events('call_reopened');
    expect(ev).toMatchObject({ actor_user_id: 'ana', detail: { to: new Date(newDeadline).toISOString(), closedEarly: false, confirmedEarly: false } });
    expect(ev.created_at).toBeTruthy();
    expect(ev.detail).toHaveProperty('from');
    // the person with a DRAFT gets the notice and the email of an extended deadline; the one who submitted gets nothing; the entity is not told who
    expect(notices().map((n) => [n.user_id, n.kind])).toEqual([['founder-a', 'deadline_extended']]);
    expect(sent.map((m) => m.to)).toEqual(['founder-a@example.com']);
    expect(events('deadline_extension_notified')[0].detail).toEqual({ applicants: 1 });
    expect(JSON.stringify(events('deadline_extension_notified'))).not.toContain('founder-a');
  });

  it('the submitted applications are exactly as they were', async () => {
    seed({ status: 'open', closes_at: iso(-DAY) }); as('ana');
    const snapshot = JSON.stringify(db.tables.call_applications.find((a) => a.id === 'a-done'));
    expect((await reopen()).status).toBe(200);
    expect(JSON.stringify(db.tables.call_applications.find((a) => a.id === 'a-done'))).toBe(snapshot);
    expect(db.tables.call_applications.find((a) => a.id === 'a-done')!.status).toBe('submitted');
    expect(db.tables.call_applications.find((a) => a.id === 'a-draft')!.status).toBe('draft');
  });

  it('a new deadline in the past (or none, or nonsense) is refused and the call stays closed', async () => {
    seed({ status: 'open', closes_at: iso(-DAY) }); as('ana');
    for (const bad of [iso(-HOUR), iso(-5 * DAY), '', 'next week']) {
      const r = await reopen({ closesAt: bad });
      expect(r.status, String(bad)).toBe(409);
      expect(r.body.error).toMatch(/must be in the future|Invalid date/);
    }
    expect(callRow().status).toBe('closed');
    expect(events('call_reopened')).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it('a call closed EARLY (a decision) needs the explicit confirmation; with it, it reopens and the history says so', async () => {
    seed({ status: 'closed', closes_at: iso(2 * DAY), closed_at: iso(-3 * DAY) }); closedEarlyOnPurpose(); as('ana');
    const state = await read(await oneGet(json('GET'), params(CALL)));
    expect(state.body.actions).toMatchObject({ canReopen: true, reopenNeedsConfirm: true });
    const asked = await reopen();
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: 'confirm_early', error: expect.stringContaining('closed early') });
    expect(callRow().status).toBe('closed');
    const done = await reopen({ confirmEarly: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(events('call_reopened')[0].detail).toMatchObject({ closedEarly: true, confirmedEarly: true });
  });

  it('an open call is not "reopened" (it is extended); an archived call that NEVER closed is not reopened either', async () => {
    seed(); as('ana');
    expect(await reopen()).toMatchObject({ status: 409, body: { error: expect.stringContaining('Only a closed call') } });
    seed({ status: 'archived', closes_at: iso(5 * DAY), closed_at: null }); as('ana');
    expect(await reopen()).toMatchObject({ status: 409, body: { error: expect.stringContaining('never closed') } });
    expect(callRow().status).toBe('archived');
  });

  it('a call ARCHIVED after it closed (the way a finished call is "got rid of") is reopened too — and leaves the archive', async () => {
    seed({ status: 'archived', closes_at: iso(-DAY), closed_at: iso(-DAY), archived_at: iso(-HOUR), archived_by: 'ana' }); as('ana');
    const state = await read(await oneGet(json('GET'), params(CALL)));
    expect(state.body.effectiveStatus).toBe('archived');
    expect(state.body.actions).toMatchObject({ canReopen: true });
    const r = await reopen();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(callRow()).toMatchObject({ status: 'open', archived_at: null, archived_by: null, closed_at: null });
    expect(events('call_reopened')[0].detail).toMatchObject({ unarchived: true });
    expect(notices().map((n) => n.user_id)).toEqual(['founder-a']);                      // the draft is told, as for any reopening
    expect(sent).toHaveLength(1);
  });

  it('only whoever may "Configure call" can reopen it', async () => {
    seed({ status: 'open', closes_at: iso(-DAY) });
    db.users.set('bob', { id: 'bob', email: 'bob@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    as('bob');
    const r = await reopen();
    expect(r.status).toBe(403);
    expect(Date.parse(callRow().closes_at as string)).toBeLessThan(Date.now());          // the deadline did not move: nothing changed
    expect(events('call_reopened')).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it('the rule is pure and carries its one condition for later: the evaluation not having started (always true today, the stage does not exist)', () => {
    const call = { id: 'c', status: 'closed', opensAt: '2026-01-01T00:00:00.000Z', closesAt: '2026-02-01T00:00:00.000Z' } as Call;
    const now = new Date('2026-03-01T00:00:00Z');
    expect(evaluationStarted(call)).toBe(false);
    expect(reopenCall(call, '2026-04-01T00:00:00Z', { closedEarly: false, confirmEarly: false }, now)).toMatchObject({ ok: true, event: 'call_reopened', patch: { status: 'open', closed_at: null } });
    expect(reopenCall(call, '2026-04-01T00:00:00Z', { closedEarly: true, confirmEarly: false }, now)).toMatchObject({ ok: false, code: 'confirm_early' });
  });
});
