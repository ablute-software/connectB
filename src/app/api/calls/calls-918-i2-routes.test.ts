// Prompt 918 (I2) — the Eligibility step through the real handlers over the stateful fake database: the rules are saved and read back (sentence, problems, recipe); the server refuses what does not fit;
// the rules are edited in place while the call is a draft, locked once confirmed, FROZEN once it has opened (a change makes a NEW version and asks first, recording the before and the after); the
// import's suggestions come back as suggestions and can be discarded; an open requirement turns into a closed question; a duplicated call gets rules and recipes of its own; one call's rules never
// touch another's; and a rule that no longer fits blocks "Confirm".
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as oneGet } from './[id]/route';
import { PUT as formPut } from './[id]/form/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as actionPost } from './[id]/action/route';
import { GET as eligGet, PUT as eligPut } from './[id]/eligibility/route';
import { POST as dismissPost } from './[id]/eligibility/suggestion/route';
import { POST as closePost } from './[id]/eligibility/close-question/route';
import { newField } from '@/lib/calls/form-builder';
import type { FormField } from '@/lib/calls/types';

const FIRM = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

const Q = { sector: '10000000-0000-4000-8000-000000000001', raised: '10000000-0000-4000-8000-000000000002', seat: '10000000-0000-4000-8000-000000000004', cert: '10000000-0000-4000-8000-000000000005', name: '10000000-0000-4000-8000-000000000006', impact: '10000000-0000-4000-8000-000000000008' };
const formFields = (): FormField[] => [
  { ...newField('single_choice', 1, 0), id: Q.sector, label: 'Sector', options: [{ id: 'o-health', label: 'Health' }, { id: 'o-energy', label: 'Energy' }, { id: 'o-other', label: 'Other' }] },
  { ...newField('number', 1, 1), id: Q.raised, label: 'Amount you are raising' },
  { ...newField('yes_no', 1, 2), id: Q.seat, label: 'Is your head office in Portugal?' },
  { ...newField('file', 2, 0), id: Q.cert, label: 'Permanent Certificate', instruction: 'Issued less than 3 months ago.' },
  { ...newField('short_text', 1, 3), id: Q.name, label: 'Company name' },
  { ...newField('long_text', 1, 4), id: Q.impact, label: 'Does the project have a social impact?' },
];
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const version = async (id: string) => (await read(await oneGet(json('GET'), params(id)))).body.call.configVersion as number;

async function newCall(name = 'Rules Call', ids: 'a' | 'b' = 'a') {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  expect(created.status).toBe(200);
  const id = created.body.call.id as string;
  const saved = await read(await formPut(json('PUT', { baseVersion: await version(id), fields: ids === 'a' ? formFields() : formFields().map((f) => ({ ...f, id: f.id.replace('10000000', '20000000') })) }), params(id)));
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  Object.assign(row(id), { opens_at: new Date(Date.now() + 2 * DAY).toISOString(), closes_at: new Date(Date.now() + 40 * DAY).toISOString() });
  return id;
}
const view = async (id: string) => (await read(await eligGet(json('GET'), params(id)))).body;
const put = async (id: string, rules: unknown[], extra: Record<string, unknown> = {}) => { const v = await view(id); return read(await eligPut(json('PUT', { baseRev: v.rev, rules, ...extra }), params(id))); };
const RULES = () => [
  { fieldId: Q.sector, kind: 'options', params: { accepted: ['o-health', 'o-energy'], mode: 'any' } },
  { fieldId: Q.raised, kind: 'number', params: { op: 'lte', value: 500000 } },
  { fieldId: Q.cert, kind: 'doc_valid', params: { maxAgeMonths: null, matchName: Q.name, matchTaxId: null } },
  { fieldId: Q.impact, kind: 'open', params: { text: 'Has a social impact' } },
];
const rulesOf = (callId: string, v?: number) => db.tables.call_eligibility_rules.filter((r) => r.call_id === callId && (v === undefined || r.version === v));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() };
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saving and reading the rules (while the call is a draft)', () => {
  it('saves them in place, with the sentence of each, a recipe for the document rule, and the step\'s state in the call', async () => {
    const id = await newCall();
    expect((await view(id)).mode).toBe('edit');
    const r = await put(id, RULES());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rules.map((x: { kind: string }) => x.kind)).toEqual(['options', 'number', 'doc_valid', 'open']);
    expect(r.body.rules[1].sentence.replace(/\s/g, ' ')).toContain('500 000 € or less');
    expect(r.body.rules[1].sentence.replace(/\s/g, ' ')).toContain('exactly 500 000 € is eligible');
    expect(r.body.rules[2].recipe.join(' ')).toContain('We look for: Permanent Certificate');
    expect(r.body.rules[0].recipe).toBeNull();
    expect(r.body.version).toBe(1);
    expect(db.tables.call_eligibility_recipes).toMatchObject([{ call_id: id, field_id: Q.cert, version: 1 }]);
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body.eligibilityRules).toBe(4);
  });

  it('refuses what does not fit, with the sentence — and stores nothing', async () => {
    const id = await newCall();
    expect((await put(id, [{ fieldId: Q.raised, kind: 'options', params: { accepted: ['x'] } }])).status).toBe(400);
    expect((await put(id, [{ fieldId: 'no-such-question', kind: 'yes_no', params: { expected: 'yes' } }])).status).toBe(400);
    expect((await put(id, [{ fieldId: Q.raised, kind: 'number', params: { op: 'lte', value: 'lots' } }])).body.error).toMatch(/digits only/);
    expect(rulesOf(id)).toHaveLength(0);
  });

  it('two people editing: the second save is refused (conflict) instead of overwriting the first', async () => {
    const id = await newCall();
    const stale = (await view(id)).rev;
    expect((await put(id, RULES())).status).toBe(200);
    const late = await read(await eligPut(json('PUT', { baseRev: stale, rules: [] }), params(id)));
    expect(late).toMatchObject({ status: 409, body: { code: 'conflict' } });
    expect(rulesOf(id)).toHaveLength(4);
  });

  it('sending the same rules again changes nothing (no new revision, no event)', async () => {
    const id = await newCall();
    const first = await put(id, RULES());
    const events = db.tables.call_events.filter((e) => e.event === 'eligibility_rules_changed').length;
    const again = await read(await eligPut(json('PUT', { baseRev: first.body.rev, rules: first.body.rules.map((r: { id: string; fieldId: string; kind: string; params: unknown; note: string | null }) => ({ id: r.id, fieldId: r.fieldId, kind: r.kind, params: r.params, note: r.note })) }), params(id)));
    expect(again.body).toMatchObject({ ok: true, unchanged: true, rev: first.body.rev });
    expect(db.tables.call_events.filter((e) => e.event === 'eligibility_rules_changed')).toHaveLength(events);
  });

  it('removing a rule removes its recipe; a document rule gets its recipe again when edited', async () => {
    const id = await newCall();
    const first = await put(id, RULES());
    const without = first.body.rules.filter((r: { kind: string }) => r.kind !== 'doc_valid').map((r: { id: string; fieldId: string; kind: string; params: unknown }) => ({ id: r.id, fieldId: r.fieldId, kind: r.kind, params: r.params }));
    const r = await put(id, without);
    expect(r.status).toBe(200);
    expect(db.tables.call_eligibility_recipes).toHaveLength(0);
  });

  it('only whoever may "Configure call" writes; a plain member may read', async () => {
    const id = await newCall();
    db.users.set('bob', { id: 'bob', email: 'bob@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    as('bob');
    expect((await eligPut(json('PUT', { baseRev: 0, rules: [] }), params(id))).status).toBe(403);
    expect((await eligGet(json('GET'), params(id))).status).toBe(200);
    as(null);
    expect((await eligGet(json('GET'), params(id))).status).toBe(401);
  });
});

describe('the lifecycle: locked, then frozen with versions', () => {
  it('confirmed (validated): locked, like the form', async () => {
    const id = await newCall();
    Object.assign(row(id), { status: 'validated' });
    const r = await put(id, RULES());
    expect(r).toMatchObject({ status: 409, body: { code: 'locked' } });
    expect((await view(id)).mode).toBe('locked');
  });

  it('open: a change asks first (naming how many submitted applications are evaluated again), then makes version 2 and keeps version 1 for the record, with the before and the after in the history', async () => {
    const id = await newCall();
    await put(id, RULES());
    Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString() });
    db.tables.call_applications.push({ id: 'a1', call_id: id, status: 'submitted', startup_org_id: null, applicant_user_id: 'u1', unit_key: 'u:1', reference: 'R1', updated_at: new Date().toISOString() });
    expect((await view(id)).mode).toBe('versioned');
    const changed = RULES().filter((r) => r.kind !== 'open');
    const asked = await put(id, changed);
    expect(asked).toMatchObject({ status: 409, body: { code: 'needs_confirm', submitted: 1, nextVersion: 2 } });
    expect(asked.body.error).toContain('evaluates the 1 submitted application again');
    expect(rulesOf(id, 2)).toHaveLength(0);
    const done = await put(id, changed, { confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.version).toBe(2);
    expect(rulesOf(id, 1)).toHaveLength(4);                      // the previous version stays
    expect(rulesOf(id, 2)).toHaveLength(3);
    expect(row(id).eligibility_version).toBe(2);
    const ev = db.tables.call_events.filter((e) => e.call_id === id && e.event === 'eligibility_rules_changed').pop()!;
    expect(ev.detail).toMatchObject({ mode: 'versioned', version: 2 });
    expect((ev.detail as { before: string[] }).before).toHaveLength(4);
    expect((ev.detail as { after: string[] }).after).toHaveLength(3);
    expect(db.tables.call_eligibility_recipes.filter((r) => r.version === 2)).toHaveLength(1);
  });

  it('archived: nothing changes', async () => {
    const id = await newCall();
    Object.assign(row(id), { status: 'archived' });
    expect((await put(id, RULES())).status).toBe(409);
  });
});

describe('suggestions from the import', () => {
  const run = (id: string, eligibility: string[]) => db.tables.call_import_runs.push({ id: `run-${db.tables.call_import_runs.length}`, call_id: id, status: 'proposed', proposal: {}, found_later: { eligibility, evaluation: [] }, created_by: 'ana', created_at: new Date().toISOString() });

  it('appear as suggestions, never as rules; a discarded one does not come back; one the entity already turned into a rule is not offered again', async () => {
    const id = await newCall();
    run(id, ['Startups founded less than 5 years ago', 'Head office in Portugal', 'Has a social impact']);
    expect((await view(id)).suggestions).toHaveLength(3);
    expect((await view(id)).rules).toHaveLength(0);
    expect((await read(await dismissPost(json('POST', { text: 'Head office in Portugal' }), params(id)))).status).toBe(200);
    expect((await view(id)).suggestions).toEqual(['Startups founded less than 5 years ago', 'Has a social impact']);
    await put(id, [{ fieldId: Q.impact, kind: 'open', params: { text: 'Has a social impact' }, note: 'Has a social impact' }]);
    expect((await view(id)).suggestions).toEqual(['Startups founded less than 5 years ago']);
  });

  it('are per call: another call\'s import findings never show here', async () => {
    const a = await newCall('A'); const b = await newCall('B', 'b');
    run(a, ['Only for call A']);
    expect((await view(b)).suggestions).toEqual([]);
  });
});

describe('an open requirement becomes a closed question', () => {
  it('adds a Yes/No question to the end of the form, replaces the open rule with a Yes/No rule on it, and is in the history', async () => {
    const id = await newCall();
    const saved = await put(id, [{ fieldId: Q.impact, kind: 'open', params: { text: 'The project has a social impact.' } }]);
    const ruleId = saved.body.rules[0].id as string;
    const r = await read(await closePost(json('POST', { ruleId }), params(id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.added.label).toBe('Can you confirm the following? The project has a social impact.');
    const fields = db.tables.call_form_fields.filter((f) => f.call_id === id);
    const added = fields.find((f) => f.id === r.body.added.id)!;
    expect(added).toMatchObject({ kind: 'yes_no', required: true });
    const after = (await view(id)).rules;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: ruleId, kind: 'yes_no', fieldId: added.id, params: { expected: 'yes' } });
    expect(db.tables.call_events.some((e) => e.event === 'eligibility_open_rule_closed')).toBe(true);
  });

  it('only while the form is editable; only for an open rule', async () => {
    const id = await newCall();
    const saved = await put(id, [{ fieldId: Q.impact, kind: 'open', params: { text: 'x' } }, { fieldId: Q.seat, kind: 'yes_no', params: { expected: 'yes' } }]);
    expect((await read(await closePost(json('POST', { ruleId: saved.body.rules[1].id }), params(id)))).status).toBe(404);
    Object.assign(row(id), { status: 'open' });
    expect((await read(await closePost(json('POST', { ruleId: saved.body.rules[0].id }), params(id)))).status).toBe(409);
  });
});

describe('a duplicated call has rules and recipes of its own', () => {
  it('copies them as a copy — new ids, pointing at the copy\'s own questions — and a change in one never touches the other', async () => {
    const a = await newCall('Original');
    await put(a, RULES());
    as('ana');
    const copy = await read(await duplicatePost(json('POST'), params(a)));
    const b = copy.body.call.id as string;
    const va = await view(a); const vb = await view(b);
    expect(vb.rules.map((r: { kind: string }) => r.kind)).toEqual(va.rules.map((r: { kind: string }) => r.kind));
    expect(vb.rules.every((r: { id: string }) => !va.rules.some((x: { id: string }) => x.id === r.id))).toBe(true);
    const copyFieldIds = db.tables.call_form_fields.filter((f) => f.call_id === b).map((f) => f.id);
    expect(vb.rules.every((r: { fieldId: string }) => copyFieldIds.includes(r.fieldId))).toBe(true);
    // the comparison of the document rule points at the COPY's company-name question
    const docRule = db.tables.call_eligibility_rules.find((r) => r.call_id === b && r.kind === 'doc_valid')!;
    expect(copyFieldIds).toContain((docRule.params as { matchName: string }).matchName);
    expect(db.tables.call_eligibility_recipes.filter((r) => r.call_id === b)).toHaveLength(1);
    // isolation: changing the original leaves the copy as it was
    await put(a, []);
    expect(rulesOf(a)).toHaveLength(0);
    expect(rulesOf(b)).toHaveLength(4);
    expect(db.tables.call_eligibility_recipes.filter((r) => r.call_id === a)).toHaveLength(0);
    expect(db.tables.call_eligibility_recipes.filter((r) => r.call_id === b)).toHaveLength(1);
    expect(row(b).eligibility_version).toBe(1);
  });

  it('a recipe is never read from another call: the same kind of document in two calls gives two recipes, each its own', async () => {
    const a = await newCall('A'); const b = await newCall('B', 'b');
    await put(a, [{ fieldId: Q.cert, kind: 'doc_right', params: { docType: 'cap_table' } }]);
    await put(b, [{ fieldId: Q.cert.replace('10000000', '20000000'), kind: 'doc_right', params: { docType: 'pitch_deck' } }]);
    const rec = (c: string) => (db.tables.call_eligibility_recipes.find((r) => r.call_id === c)!.recipe as { docType: string }).docType;
    expect([rec(a), rec(b)]).toEqual(['cap_table', 'pitch_deck']);
  });
});

describe('what is missing, and confirming', () => {
  it('a rule whose question was removed from the form blocks "Confirm" and says so, with the step to go to', async () => {
    const id = await newCall();
    Object.assign(row(id), { name: 'Ready', description: 'x' });
    await put(id, [{ fieldId: Q.seat, kind: 'yes_no', params: { expected: 'yes' } }]);
    // the entity deletes the question
    const rest = formFields().filter((f) => f.id !== Q.seat);
    await read(await formPut(json('PUT', { baseVersion: await version(id), fields: rest }), params(id)));
    const state = await read(await oneGet(json('GET'), params(id)));
    const issue = state.body.issues.find((i: { tab: string }) => i.tab === 'eligibility');
    expect(issue.message).toMatch(/no longer exists in the form/);
    expect((await read(await actionPost(json('POST', { action: 'confirm' }), params(id)))).status).toBe(409);
    expect((await view(id)).rules[0].problems.length).toBeGreaterThan(0);
  });
});
