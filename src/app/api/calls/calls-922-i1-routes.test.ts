// Prompt 922 (I1) — the evaluation grid through the real handlers over the stateful fake database: saved and read back (weights live, formula, examples); the weights are not forced to 100 while it is being built
// but block "Confirm"; locked once the call is confirmed; frozen with a new VERSION once an evaluation is submitted (the evaluations keep theirs); the blind option locked once an evaluation exists; a grid
// read from an Excel document by the platform's own reader — and NO call to an AI provider in any case; templates of the entity (copies, never shared); a duplicated call gets a copy of its own.
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const providerCalls: string[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
// Any module that could reach an AI provider is replaced by one that records the call — and the test fails if it is ever called.
vi.mock('@/lib/calls/ai-import/anthropic', () => new Proxy({}, { get: (_t, name) => (() => { providerCalls.push(String(name)); throw new Error('an AI provider was called'); }) }));

import { POST as createPost } from './route';
import { GET as oneGet } from './[id]/route';
import { PUT as formPut } from './[id]/form/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as actionPost } from './[id]/action/route';
import { GET as gridGet, PUT as gridPut } from './[id]/eval-grid/route';
import { POST as importPost } from './[id]/eval-grid/import/route';
import { GET as tplList, POST as tplSave } from './[id]/eval-grid/templates/route';
import { DELETE as tplDelete, POST as tplUse } from './[id]/eval-grid/templates/[templateId]/route';
import { newField } from '@/lib/calls/form-builder';

const FIRM = '11111111-1111-4111-8111-111111111111';
const FIRM_2 = '99999999-9999-4999-8999-999999999999';
const DAY = 86_400_000;
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const version = async (id: string) => (await read(await oneGet(json('GET'), params(id)))).body.call.configVersion as number;

async function newCall(name = 'Grid Call') {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  const id = created.body.call.id as string;
  await read(await formPut(json('PUT', { baseVersion: await version(id), fields: [{ ...newField('short_text', 1, 0), label: 'Startup name' }] }), params(id)));
  Object.assign(row(id), { opens_at: new Date(Date.now() + 2 * DAY).toISOString(), closes_at: new Date(Date.now() + 40 * DAY).toISOString() });
  return id;
}
const view = async (id: string) => (await read(await gridGet(json('GET'), params(id)))).body;
const CRITERIA = () => [
  { name: 'Team', weight: 25, scaleMin: 1, scaleMax: 5, levels: [{ from: 1, text: 'weak' }, { from: 5, text: 'excellent' }], commentRequired: true, minScore: 2 },
  { name: 'Technology', weight: 25, scaleMin: 0, scaleMax: 10 },
  { name: 'Market', weight: 50, scaleMin: 1, scaleMax: 5, section: 'Business' },
];
const put = async (id: string, criteria: unknown[], extra: Record<string, unknown> = {}) => { const v = await view(id); return read(await gridPut(json('PUT', { baseRev: v.rev, criteria, settings: extra.settings ?? v.settings, ...extra }), params(id))); };
const criteriaOf = (id: string, v = 1) => db.tables.call_eval_criteria.filter((c) => c.call_id === id && c.version === v);

async function xlsx(rows: unknown[][]): Promise<File> {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Grid');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new File([new Uint8Array(buf)], 'grid.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const upload = async (id: string, file: File | null) => {
  const form = new FormData(); if (file) form.append('file', file);
  return read(await importPost(new NextRequest('http://localhost/api/x', { method: 'POST', body: form }), params(id)));
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; providerCalls.length = 0;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false }, { id: FIRM_2, name: 'zz-test-firm-2', is_test: false });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' }); db.users.set('zoe', { id: 'zoe', email: 'zoe@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.matchdeal_investor_members.push({ id: 'm-zoe', user_id: 'zoe', catalog_entity_id: FIRM_2, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url: unknown) => { providerCalls.push(`fetch ${String(url)}`); throw new Error('no network in this test'); });
});

describe('before the migration is applied', () => {
  it('every evaluation route answers "not available yet" (503) instead of a database error, and the rest of the call keeps working', async () => {
    const id = await newCall();
    delete (db.tables as Record<string, unknown>).call_eval_settings;
    const get = await read(await gridGet(json('GET'), params(id)));
    expect(get).toMatchObject({ status: 503, body: { ok: false, code: 'not_available', error: 'Evaluation is not available yet. It will be switched on shortly.' } });
    expect((await read(await gridPut(json('PUT', { baseRev: 0, criteria: [], settings: {} }), params(id)))).status).toBe(503);
    expect((await upload(id, await xlsx([['Team', '100%']]))).status).toBe(503);
    expect((await read(await tplList(json('GET'), params(id)))).status).toBe(503);
    expect((await read(await tplSave(json('POST', { name: 'x' }), params(id)))).status).toBe(503);
    expect((await read(await oneGet(json('GET'), params(id)))).status).toBe(200);              // the call itself is untouched
  });
});

describe('saving and reading the grid', () => {
  it('saves criteria with different scales, levels, comments, sections and a minimum; reads them back with the live weights, the formula and the examples; the settings default to 2 evaluators, not blind', async () => {
    const id = await newCall();
    const v0 = await view(id);
    expect(v0).toMatchObject({ mode: 'edit', version: 1, criteria: [], settings: { evaluatorsPerApplication: 2, blind: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 } } });
    const r = await put(id, CRITERIA());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.criteria.map((c: { name: string; weight: number; scaleMin: number; scaleMax: number }) => [c.name, c.weight, c.scaleMin, c.scaleMax])).toEqual([['Team', 25, 1, 5], ['Technology', 25, 0, 10], ['Market', 50, 1, 5]]);
    expect(r.body.criteria[0]).toMatchObject({ commentRequired: true, minScore: 2, levels: [{ from: 1, to: 1, text: 'weak' }, { from: 5, to: 5, text: 'excellent' }] });
    expect(r.body.criteria[2].section).toBe('Business');
    expect(r.body.weights).toMatchObject({ ok: true, sum: 100, text: 'Sum of the weights: 100 % ✓' });
    expect(r.body.formula).toContain('each score converted to % of its own scale first');
    expect(r.body.examples).toHaveLength(3);
    expect(r.body.problems).toEqual([]);
    expect(criteriaOf(id)).toHaveLength(3);
  });

  it('the weights are not forced to 100 while it is built — the step says so and "Confirm" is blocked until they add up', async () => {
    const id = await newCall();
    Object.assign(row(id), { name: 'Ready', description: 'x' });
    const r = await put(id, CRITERIA().slice(0, 2));
    expect(r.status).toBe(200);
    expect(r.body.weights).toMatchObject({ ok: false, sum: 50, text: 'Sum of the weights: 50 % — 50 % missing' });
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body.evalCriteria).toBe(2);
    expect(state.body.issues.find((i: { tab: string }) => i.tab === 'grid')?.message).toContain('add up to 50 %');
    expect((await read(await actionPost(json('POST', { action: 'confirm' }), params(id)))).status).toBe(409);
    expect((await put(id, CRITERIA())).body.problems).toEqual([]);
    expect((await read(await oneGet(json('GET'), params(id)))).body.issues.filter((i: { tab: string }) => i.tab === 'grid')).toEqual([]);
  });

  it('refuses what does not fit, with the sentence, and stores nothing', async () => {
    const id = await newCall();
    expect((await put(id, [{ name: '', weight: 10, scaleMin: 1, scaleMax: 5 }])).body.error).toMatch(/give it a name/);
    expect((await put(id, [{ name: 'A', weight: 10, scaleMin: 5, scaleMax: 1 }])).body.error).toMatch(/minimum below its maximum/);
    expect((await put(id, [{ name: 'A', weight: 10, scaleMin: 0, scaleMax: 40 }])).body.error).toMatch(/at most 21 levels/);
    expect((await put(id, CRITERIA(), { settings: { evaluatorsPerApplication: 0 } })).body.error).toMatch(/at least 1/);
    expect(criteriaOf(id)).toHaveLength(0);
  });

  it('settings: any number of evaluators (no maximum), "all", blind, divergence limits, a deadline per phase', async () => {
    const id = await newCall();
    const phaseId = db.tables.call_phases.find((p) => p.call_id === id)!.id as string;
    const settings = { evaluatorsPerApplication: 25, blind: true, commentRequiredForAll: true, divergence: { enabled: true, scalePct: 30, totalPct: 15 }, deadlines: [{ phaseId, day: '2026-12-15' }] };
    const r = await put(id, CRITERIA(), { settings });
    expect(r.body.settings).toEqual(settings);
    expect((await put(id, CRITERIA(), { settings: { ...settings, evaluatorsPerApplication: 'all' } })).body.settings.evaluatorsPerApplication).toBe('all');
    expect((await put(id, CRITERIA(), { settings: { ...settings, deadlines: [{ phaseId: 'nope', day: '2026-12-15' }] } })).status).toBe(400);
  });

  it('two people editing: the second save is refused (conflict); sending the same grid again changes nothing', async () => {
    const id = await newCall();
    const stale = (await view(id)).rev;
    const first = await put(id, CRITERIA());
    expect((await read(await gridPut(json('PUT', { baseRev: stale, criteria: [], settings: {} }), params(id)))).body.code).toBe('conflict');
    expect(criteriaOf(id)).toHaveLength(3);
    const again = await read(await gridPut(json('PUT', { baseRev: first.body.rev, criteria: first.body.criteria, settings: first.body.settings }), params(id)));
    expect(again.body).toMatchObject({ ok: true, unchanged: true, rev: first.body.rev });
  });

  it('only whoever may "Configure call" writes; a plain member may read', async () => {
    const id = await newCall();
    db.users.set('bob', { id: 'bob', email: 'bob@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    as('bob');
    expect((await gridPut(json('PUT', { baseRev: 0, criteria: [], settings: {} }), params(id))).status).toBe(403);
    expect((await gridGet(json('GET'), params(id))).status).toBe(200);
    as(null);
    expect((await gridGet(json('GET'), params(id))).status).toBe(401);
  });
});

describe('the lifecycle: locked, then frozen with versions', () => {
  it('confirmed: locked like the form; archived: nothing changes', async () => {
    const id = await newCall();
    await put(id, CRITERIA());
    Object.assign(row(id), { status: 'validated' });
    expect(await put(id, CRITERIA())).toMatchObject({ status: 409, body: { code: 'locked' } });
    expect((await view(id)).mode).toBe('locked');
    Object.assign(row(id), { status: 'archived' });
    expect((await put(id, CRITERIA())).status).toBe(409);
  });

  it('an open call with no evaluation submitted yet: edited in place; with one submitted the grid is FROZEN — a change asks, then makes version 2 and the evaluation keeps version 1', async () => {
    const id = await newCall();
    await put(id, CRITERIA());
    Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString() });
    expect((await view(id)).mode).toBe('edit');
    const tweak = CRITERIA(); tweak[0].weight = 20; tweak[2].weight = 55;
    expect((await put(id, tweak)).status).toBe(200);                                         // in place: version still 1
    expect(row(id).eval_grid_version).toBe(1);
    db.tables.call_evaluations.push({ id: 'ev-1', call_id: id, application_id: 'app-1', evaluator_user_id: 'rita', grid_version: 1, status: 'submitted', submitted_at: new Date().toISOString() });
    expect((await view(id)).mode).toBe('versioned');
    const again = CRITERIA(); again[1].name = 'Technology & IP';
    const asked = await put(id, again);
    expect(asked).toMatchObject({ status: 409, body: { code: 'needs_confirm', evaluations: 1, nextVersion: 2 } });
    expect(asked.body.error).toContain('1 evaluation was already submitted on version 1');
    expect(criteriaOf(id, 2)).toHaveLength(0);
    const done = await put(id, again, { confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.version).toBe(2);
    expect(criteriaOf(id, 1).map((c) => c.name)).toEqual(['Team', 'Technology', 'Market']);          // version 1 stays
    expect(criteriaOf(id, 2).map((c) => c.name)).toEqual(['Team', 'Technology & IP', 'Market']);
    expect(db.tables.call_evaluations[0].grid_version).toBe(1);                                    // the evaluation keeps its version
    const ev = db.tables.call_events.filter((e) => e.event === 'eval_grid_changed').pop()!;
    expect(ev.detail).toMatchObject({ mode: 'versioned', version: 2 });
    expect((ev.detail as { before: string[]; after: string[] }).before).toHaveLength(3);
  });

  it('the settings that stay editable never make a version; blind and "comment required for all" are locked once an evaluation exists', async () => {
    const id = await newCall();
    await put(id, CRITERIA());
    Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString() });
    db.tables.call_evaluations.push({ id: 'ev-1', call_id: id, application_id: 'a', evaluator_user_id: 'rita', grid_version: 1, status: 'in_progress' });
    const v = await view(id);
    expect(v.settingsLocked).toBe(true);
    const ok = await put(id, CRITERIA(), { settings: { ...v.settings, evaluatorsPerApplication: 4, divergence: { enabled: false, scalePct: 40, totalPct: 20 } } });
    expect(ok.status).toBe(200);
    expect(row(id).eval_grid_version).toBe(1);
    const locked = await put(id, CRITERIA(), { settings: { ...v.settings, blind: true } });
    expect(locked).toMatchObject({ status: 409, body: { code: 'settings_locked' } });
  });
});

describe('a grid read from a document — by the platform only', () => {
  it('reads an Excel sheet: the criteria, the weights, the scales, with where each came from; the proposal is kept for this call', async () => {
    const id = await newCall();
    const r = await upload(id, await xlsx([['Criterion', 'Weight', 'Scale'], ['Team', 40, '1-5'], ['Market', 35, '0-10'], ['Traction', 25, '1-5']]));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.notice).toBe('Read on our platform only. Evaluation grids are never sent to an AI provider.');
    expect(r.body.proposal.criteria.map((c: { name: string; weight: number }) => [c.name, c.weight])).toEqual([['Team', 40], ['Market', 35], ['Traction', 25]]);
    expect(r.body.proposal.criteria[0].source.line).toBeGreaterThan(0);
    expect(r.body.criteria.map((c: { scaleMin: number; scaleMax: number }) => `${c.scaleMin}-${c.scaleMax}`)).toEqual(['1-5', '0-10', '1-5']);
    expect(db.tables.call_eval_import_runs).toMatchObject([{ call_id: id, file_name: 'grid.xlsx', status: 'proposed' }]);
    expect(JSON.stringify(db.tables.call_eval_import_runs[0])).not.toContain('PK');             // the bytes are not kept
  });

  it('what the administrator corrects is kept for this call when the grid is applied', async () => {
    const id = await newCall();
    const r = await upload(id, await xlsx([['Criterion', 'Weight', 'Scale'], ['Team', 40, '1-5'], ['Market', 35, '1-5'], ['Traction', 25, '1-5']]));
    const edited = r.body.criteria.map((c: Record<string, unknown>) => ({ ...c, ...(c.name === 'Team' ? { weight: 45 } : {}), ...(c.name === 'Traction' ? { weight: 20 } : {}) }));
    const saved = await put(id, edited, { importRunId: r.body.runId });
    expect(saved.status).toBe(200);
    expect(db.tables.call_eval_import_runs[0]).toMatchObject({ status: 'applied' });
    expect(db.tables.call_eval_import_runs[0].corrections).toEqual(expect.arrayContaining([{ kind: 'weight', name: 'Team', from: 40, to: 45 }, { kind: 'weight', name: 'Traction', from: 25, to: 20 }]));
  });

  it('NEVER calls an AI provider — not for a grid it reads, not for one it cannot (no fallback): the test fails on any call', async () => {
    const id = await newCall();
    expect((await upload(id, await xlsx([['Team', '50%'], ['Market', '50%']]))).status).toBe(200);
    const unreadable = await upload(id, new File([new Uint8Array([1, 2, 3, 4])], 'grid.pdf', { type: 'application/pdf' }));
    expect(unreadable.status).toBe(422);
    expect(unreadable.body.error).toBeTruthy();
    expect((await upload(id, null)).status).toBe(400);
    expect(providerCalls).toEqual([]);
  });

  it('is refused when the grid is locked, and for whoever may not configure the call', async () => {
    const id = await newCall();
    Object.assign(row(id), { status: 'validated' });
    expect((await upload(id, await xlsx([['Team', '100%']]))).status).toBe(409);
    Object.assign(row(id), { status: 'draft' });
    db.users.set('bob', { id: 'bob', email: 'bob@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    as('bob');
    expect((await upload(id, await xlsx([['Team', '100%']]))).status).toBe(403);
  });
});

describe('templates of the entity — a copy, never shared', () => {
  it('"Save as template" keeps the grid under a name (never twice the same name); the list is the organisation\'s own; "Start from template" returns a COPY with new ids; delete works', async () => {
    const a = await newCall('A');
    await put(a, CRITERIA());
    const saved = await read(await tplSave(json('POST', { name: 'Portugal Ventures 2027' }), params(a)));
    expect(saved).toMatchObject({ status: 200, body: { ok: true } });
    expect(saved.body.templates).toMatchObject([{ name: 'Portugal Ventures 2027', criteria: 3 }]);
    expect((await read(await tplSave(json('POST', { name: 'portugal ventures 2027' }), params(a)))).status).toBe(409);
    expect((await read(await tplSave(json('POST', { name: '  ' }), params(a)))).status).toBe(400);
    expect(JSON.stringify(db.tables.call_eval_templates[0].settings)).not.toContain('deadlines');       // nothing that belongs to this call
    // a second call of the SAME entity can start from it
    const b = await newCall('B');
    const used = await read(await tplUse(json('POST'), { params: { id: b, templateId: saved.body.id } }));
    expect(used.status).toBe(200);
    expect(used.body.criteria.map((c: { name: string }) => c.name)).toEqual(['Team', 'Technology', 'Market']);
    const aIds = criteriaOf(a).map((c) => c.id);
    expect(used.body.criteria.every((c: { id: string }) => !aIds.includes(c.id))).toBe(true);
    expect(criteriaOf(b)).toHaveLength(0);                                                          // nothing is written until the editor saves
    // another ORGANISATION never sees it
    as('zoe');
    const other = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other' })));
    const o = other.body.call.id as string;
    expect((await read(await tplList(json('GET'), params(o)))).body.templates).toEqual([]);
    expect((await read(await tplUse(json('POST'), { params: { id: o, templateId: saved.body.id } }))).status).toBe(404);
    as('ana');
    expect((await read(await tplDelete(json('DELETE'), { params: { id: a, templateId: saved.body.id } }))).status).toBe(200);
    expect(db.tables.call_eval_templates).toHaveLength(0);
  });

  it('there is nothing to save as a template before there is a grid', async () => {
    const a = await newCall('A');
    expect((await read(await tplSave(json('POST', { name: 'Empty' }), params(a)))).status).toBe(409);
  });
});

describe('each call has a grid of its own', () => {
  it('a duplicated call gets a COPY (new ids, version 1, no deadlines); changing one never touches the other; nothing of the evaluations is copied', async () => {
    const a = await newCall('Original');
    const phaseId = db.tables.call_phases.find((p) => p.call_id === a)!.id as string;
    await put(a, CRITERIA(), { settings: { evaluatorsPerApplication: 4, blind: true, commentRequiredForAll: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, deadlines: [{ phaseId, day: '2026-12-15' }] } });
    db.tables.call_evaluations.push({ id: 'ev', call_id: a, application_id: 'x', evaluator_user_id: 'rita', grid_version: 1, status: 'submitted' });
    as('ana');
    const copy = await read(await duplicatePost(json('POST'), params(a)));
    const b = copy.body.call.id as string;
    const vb = await view(b);
    expect(vb.criteria.map((c: { name: string }) => c.name)).toEqual(['Team', 'Technology', 'Market']);
    expect(vb.settings).toMatchObject({ evaluatorsPerApplication: 4, blind: true, deadlines: [] });
    expect(criteriaOf(b).every((c) => !criteriaOf(a).some((x) => x.id === c.id))).toBe(true);
    expect(db.tables.call_evaluations.filter((e) => e.call_id === b)).toEqual([]);
    // a has a submitted evaluation, so changing its grid makes version 2 (after the question); b is untouched either way
    expect((await put(a, CRITERIA().slice(0, 1), { confirm: true })).status).toBe(200);
    expect(criteriaOf(a, 2)).toHaveLength(1);
    expect(criteriaOf(b)).toHaveLength(3);
    expect(row(a).eval_grid_version).toBe(2);
    expect(row(b).eval_grid_version).toBe(1);
  });
});
