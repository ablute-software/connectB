// Prompt 918 (I3) — "Report a problem" on the applicant's journey (spec §14.5): public (the code page is before sign-in), with URGENT priority and the call's context, a confirmation on screen and by email,
// the same anti-spam budget as the support form, and nothing submitted or changed by it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string } | null;
const sent: { to: string; subject: string; html: string }[] = [];
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }) }));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({
  ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true,
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string }) => { sent.push(m); return { sent: true, id: 'em' }; },
}));

import { POST as reportPost } from './public/[token]/report/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tok-rep-0123456789abcdef01';
const ORG = '33333333-3333-4333-8333-333333333333';
const DAY = 86_400_000;
const req = (body: unknown, ip = '1.2.3.4') => new NextRequest('http://localhost/api/calls/public/x/report', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'TestBrowser/1' } });
const send = (body: unknown, ip?: string) => reportPost(req(body, ip), { params: { token: TOKEN } }).then(async (r) => ({ status: r.status, body: await r.json() }));
const tickets = () => db.tables.support_tickets;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  process.env.SUPPORT_NOTIFY_EMAIL = 'support@example.test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; sent.length = 0;
  db.tables.support_tickets = []; db.tables.support_rate_limit = [];
  db.tables.catalog_entities.push({ id: FIRM, name: 'Portugal Ventures (test)', is_test: false });
  db.tables.calls.push({ id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'INNOV-ID copy', description: 'x', status: 'open', opens_at: new Date(Date.now() - DAY).toISOString(), closes_at: new Date(Date.now() + 10 * DAY).toISOString(), timezone: 'Europe/Lisbon', visibility: 'unlisted', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', link_token: TOKEN, config_version: 2, created_by: 'x', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
  db.tables.call_form_fields.push({ id: 'f1', call_id: CALL, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false, options: [], validations: {}, condition: null });
  db.tables.orgs.push({ id: ORG, name: 'Acme Robotics' });
  db.tables.org_members.push({ org_id: ORG, user_id: 'founder', role: 'owner' });
  db.users.set('founder', { id: 'founder', email: 'founder@acme.pt' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Report a problem', () => {
  it('signed out (the code page): an URGENT support ticket with the call\'s context, an email to the team, a confirmation to the person — and nothing submitted', async () => {
    const r = await send({ message: 'The code never arrives in my inbox', email: 'Visitor@Example.com', name: 'A visitor', page: '/call/xyz' });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.body.message).toContain('does not submit anything and does not change any deadline');
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]).toMatchObject({ priority: 'urgent', category: 'problem', area: 'Calls', source: 'landing', email: 'visitor@example.com', user_id: null });
    const ctx = JSON.parse(String(tickets()[0].context));
    expect(ctx).toMatchObject({ call: { id: CALL, name: 'INNOV-ID copy', promoter: 'Portugal Ventures (test)' }, application: null, page: '/call/xyz', userId: null });
    expect(ctx.call.deadline).toBeTruthy();
    expect(sent.map((m) => m.to).sort()).toEqual(['support@example.test', 'visitor@example.com']);
    expect(sent.find((m) => m.to === 'support@example.test')!.subject).toContain('URGENT');
    expect(sent.find((m) => m.to === 'visitor@example.com')!.html).toContain('does not change any deadline');
    expect(db.tables.call_applications).toHaveLength(0);
    expect(db.tables.calls[0].closes_at).toBeTruthy();
  });

  it('signed in with an application: the ticket carries the application, the person and the startup, and their own address wins over the one typed', async () => {
    db.tables.call_applications.push({ id: 'app-1', call_id: CALL, status: 'draft', startup_org_id: ORG, applicant_user_id: 'founder', draft_answers: { secret: 'x' }, reference: 'APP-AAAA-BBBB', unit_key: 'o', updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
    currentUser = { id: 'founder', email: 'founder@acme.pt' };
    const r = await send({ message: 'The file upload keeps failing at 90%', email: 'someone-else@example.com' });
    expect(r.status).toBe(200);
    expect(tickets()[0]).toMatchObject({ priority: 'urgent', user_id: 'founder', org_id: ORG, source: 'founder_app', email: 'founder@acme.pt', name: 'Acme Robotics' });
    expect(JSON.parse(String(tickets()[0].context))).toMatchObject({ application: { id: 'app-1', reference: 'APP-AAAA-BBBB', status: 'draft' }, userId: 'founder' });
    expect(String(tickets()[0].context)).not.toContain('secret');                       // never the answers
    expect(db.tables.call_applications[0].status).toBe('draft');                         // nothing submitted
  });

  it('refuses a message that says nothing, an address that is not one, and a link that is not a call\'s', async () => {
    expect((await send({ message: 'short', email: 'a@b.co' })).status).toBe(400);
    expect((await send({ message: 'A real description of the problem', email: 'not-an-email' })).status).toBe(400);
    expect((await reportPost(req({ message: 'A real description of the problem', email: 'a@b.co' }), { params: { token: 'tok-unknown-0123456789abcd' } })).status).toBe(404);
    expect(tickets()).toHaveLength(0);
  });

  it('shares the support form anti-spam budget: too many from one address in an hour is refused (and every attempt is recorded)', async () => {
    for (let i = 0; i < 6; i++) db.tables.support_rate_limit.push({ ip: '9.9.9.9', created_at: new Date().toISOString() });
    const refused = await send({ message: 'A real description of the problem', email: 'a@b.co' }, '9.9.9.9');
    expect(refused.status).toBe(429);
    expect(tickets()).toHaveLength(0);
    expect(db.tables.support_rate_limit.filter((r) => r.ip === '9.9.9.9')).toHaveLength(7);
    expect((await send({ message: 'A real description of the problem', email: 'a@b.co' }, '8.8.8.8')).status).toBe(200);
  });

  it('the page offers it everywhere in the journey, in the page (never a dialog) and says what it does not do', async () => {
    const fs = await import('node:fs');
    const comp = fs.readFileSync(`${process.cwd()}/src/components/calls/applicant/ReportProblem.tsx`, 'utf8');
    expect(comp).not.toMatch(/window\.(confirm|alert|prompt)/);
    expect(comp).toContain('does not submit your application and does not change any deadline');
    const page = fs.readFileSync(`${process.cwd()}/src/app/call/[token]/page.tsx`, 'utf8');
    expect(page).toContain('<ReportProblem');
  });
});
