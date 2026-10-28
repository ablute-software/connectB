// Prompt 923 — Setup is only for whoever may "Configure call". The editor no longer shows the tab to anyone else, but a hidden tab protects nothing: this is the server's side of it, through the real
// handlers and the real access rules over the stateful fake database. A person who only evaluates, and one who only views the applications, send every write of the Setup to the server as if the screen
// had been bypassed — and every one of them is refused with 403 and nothing in the database moves. The state they read says what they may do (the editor opens on a tab they can use from it).
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let currentUser: { id: string; email: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as oneGet, PATCH as callPatch } from './[id]/route';
import { PUT as phasesPut } from './[id]/phases/route';
import { PUT as formPut } from './[id]/form/route';
import { PUT as eligibilityPut } from './[id]/eligibility/route';
import { PUT as gridPut } from './[id]/eval-grid/route';
import { POST as gridTemplatesPost } from './[id]/eval-grid/templates/route';
import { POST as gridImportPost } from './[id]/eval-grid/import/route';
import { POST as distributionPost } from './[id]/distribution/route';
import { POST as actionPost } from './[id]/action/route';
import { PUT as contactPut } from './[id]/contact/route';
import { DELETE as mediaDelete } from './[id]/media/route';
import { POST as importFormPost } from './[id]/import-form/route';
import { POST as convertPost } from './[id]/form/convert-to-table/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as teamPost } from './[id]/team/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body: unknown = {}) => new NextRequest('http://localhost/api/calls', { method, body: method === 'GET' ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (userId: string) => { currentUser = { id: userId, email: `${userId}@example.com` }; };
function member(userId: string, role: string, name: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  const id = `m-${userId}`;
  db.tables.matchdeal_investor_members.push({ id, user_id: userId, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.matchdeal_profiles.push({ membership_id: id, kind: 'investor', representative_name: name });
}
const categoryId = (name: string) => db.tables.call_team_categories.find((c) => c.name === name)!.id as string;

async function callWithTeam() {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Seed Call' })));
  expect(created.status).toBe(200);
  const id = created.body.call.id as string;
  const team = async (body: Record<string, unknown>) => expect((await read(await teamPost(json('POST', body), params(id)))).status).toBe(200);
  await team({ action: 'create_category', name: 'Evaluator', permissions: { evaluate_assigned: true } });
  await team({ action: 'create_category', name: 'Analyst', permissions: { view_all_applications: true } });
  await team({ action: 'add_member', userId: 'bob', categoryId: categoryId('Evaluator') });
  await team({ action: 'add_member', userId: 'dora', categoryId: categoryId('Analyst') });
  return { id, version: created.body.call.configVersion as number };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  member('ana', 'admin', 'Ana Silva'); member('bob', 'member', 'Bob Builder'); member('dora', 'member', 'Dora Analyst');
  currentUser = null;
});

describe('what the editor reads from the server to choose its tabs', () => {
  it('an administrator may configure; an analyst only views the applications; an evaluator only evaluates', async () => {
    const { id } = await callWithTeam();
    const state = async (user: string) => { as(user); return (await read(await oneGet(json('GET'), params(id)))).body; };
    expect(await state('ana')).toMatchObject({ canManage: true, canViewApplications: true, canEvaluate: true });
    expect(await state('dora')).toMatchObject({ canManage: false, canViewApplications: true, canEvaluate: false });
    expect(await state('bob')).toMatchObject({ canManage: false, canViewApplications: false, canEvaluate: true });
  });
});

describe('the server refuses every write of the Setup to whoever may not configure the call', () => {
  it('an evaluator and an analyst: 403 on every one, with the permission named, and nothing changes in the database', async () => {
    const { id, version } = await callWithTeam();
    const attempts: [string, (r: NextRequest) => Promise<Response>, string, unknown][] = [
      ['PATCH the general data', (r) => callPatch(r, params(id)), 'PATCH', { name: 'Hacked', baseVersion: version }],
      ['PUT the phases', (r) => phasesPut(r, params(id)), 'PUT', { baseVersion: version, phases: [{ name: 'Phase 1', startsOn: '2026-11-01', endsOn: '2026-11-30' }] }],
      ['PUT the form', (r) => formPut(r, params(id)), 'PUT', { baseVersion: version, fields: [] }],
      ['PUT the eligibility rules', (r) => eligibilityPut(r, params(id)), 'PUT', { rules: [] }],
      ['PUT the evaluation grid', (r) => gridPut(r, params(id)), 'PUT', { criteria: [] }],
      ['POST an evaluation grid template', (r) => gridTemplatesPost(r, params(id)), 'POST', { name: 'Mine' }],
      ['POST an evaluation grid import', (r) => gridImportPost(r, params(id)), 'POST', {}],
      ['POST the distribution', (r) => distributionPost(r, params(id)), 'POST', { action: 'redistribute' }],
      ['POST confirm', (r) => actionPost(r, params(id)), 'POST', { action: 'confirm' }],
      ['POST archive', (r) => actionPost(r, params(id)), 'POST', { action: 'archive' }],
      ['POST delete', (r) => actionPost(r, params(id)), 'POST', { action: 'delete', confirmName: 'Seed Call' }],
      ['PUT the contact email', (r) => contactPut(r, params(id)), 'PUT', { email: 'x@example.com' }],
      ['DELETE the cover image', (r) => mediaDelete(new NextRequest('http://localhost/api/calls?which=cover', { method: 'DELETE' }), params(id)), 'DELETE', {}],
      ['POST a form import', (r) => importFormPost(r, params(id)), 'POST', { sourceCallId: id, mode: 'add', baseVersion: version }],
      ['POST a conversion to a table', (r) => convertPost(r, params(id)), 'POST', {}],
      ['POST a duplicate', (r) => duplicatePost(r, params(id)), 'POST', {}],
    ];
    const before = JSON.stringify(db.tables);
    for (const user of ['bob', 'dora']) {
      as(user);
      for (const [label, handler, method, body] of attempts) {
        const res = await read(await handler(json(method, body)));
        expect(res.status, `${user}: ${label}`).toBe(403);
        expect(res.body, `${user}: ${label}`).toMatchObject({ ok: false, error: 'You do not have the “Configure call” permission on this call.' });
      }
      // the team too: "Manage team & permissions" is a separate permission they do not have either
      const team = await read(await teamPost(json('POST', { action: 'add_member', userId: user, categoryId: categoryId('Administrator') }), params(id)));
      expect(team.status, `${user}: team`).toBe(403);
    }
    expect(JSON.stringify(db.tables)).toBe(before);            // not a row moved: no edit, no event, no new member
  });

  it('the same requests from the administrator are not refused (the test is not passing because everything is refused)', async () => {
    const { id, version } = await callWithTeam();
    as('ana');
    const res = await read(await callPatch(json('PATCH', { name: 'Seed Call 2026', baseVersion: version }), params(id)));
    expect(res.status).toBe(200);
    expect(res.body.call.name).toBe('Seed Call 2026');
  });

  it('losing "Configure call" takes effect at once: the person who could write is refused the moment the permission is taken away', async () => {
    const { id, version } = await callWithTeam();
    as('ana');
    expect((await read(await teamPost(json('POST', { action: 'set_overrides', userId: 'dora', overrides: { configure_call: true } }), params(id)))).status).toBe(200);
    as('dora');
    expect((await read(await callPatch(json('PATCH', { name: 'By Dora', baseVersion: version }), params(id)))).status).toBe(200);
    as('ana');
    await teamPost(json('POST', { action: 'set_overrides', userId: 'dora', overrides: { configure_call: false } }), params(id));
    as('dora');
    expect((await read(await callPatch(json('PATCH', { name: 'Again', baseVersion: version + 1 }), params(id)))).status).toBe(403);
  });
});

// The guard under the test: a Setup route that someone adds later, and forgets to protect, fails here. Evaluators write through their own routes, which check "Evaluate assigned
// applications" / "Final decision" inside; they are the only exceptions, and each one says why.
describe('every write route of a call asks for a permission before it does anything', () => {
  const ROOT = path.join(process.cwd(), 'src/app/api/calls/[id]');
  const EXCEPTIONS: Record<string, string> = {
    'evaluation-board/route.ts#POST': 'decides, closes: "Final decision", checked inside',
    'evaluations/[applicationId]/conflict/route.ts#POST': 'the evaluator declares a conflict: "Evaluate assigned applications", checked inside',
    'evaluations/[applicationId]/route.ts#PUT': 'the evaluator saves a draft: "Evaluate assigned applications", checked inside',
    'evaluations/[applicationId]/submit/route.ts#POST': 'the evaluator submits: "Evaluate assigned applications", checked inside',
  };
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []));

  it('each POST, PUT, PATCH and DELETE calls authCall with write: true or need: …, unless it is one of the evaluator routes listed above', () => {
    const missing: string[] = [];
    let seen = 0;
    for (const file of files(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      const parts = src.split(/^export async function /m).slice(1);
      for (const part of parts) {
        const method = /^(\w+)/.exec(part)![1];
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
        seen++;
        if (EXCEPTIONS[`${rel}#${method}`]) continue;
        const call = /authCall\([^)]*\)/.exec(part)?.[0] ?? '';
        if (!/write:\s*true|need:\s*'/.test(call)) missing.push(`${rel} ${method}`);
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it('the exceptions still exist (a renamed route cannot leave a stale excuse behind)', () => {
    for (const key of Object.keys(EXCEPTIONS)) expect(fs.existsSync(path.join(ROOT, key.split('#')[0])), key).toBe(true);
  });
});
