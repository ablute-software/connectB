// Prompt 917, Adenda 2 (B) — the Table question through the real handlers over the stateful fake database: the editor saves it (and the server refuses what cannot be filled in), a duplicated call
// carries it, the applicant can only author what they are allowed to (their own columns and rows, within the entity's limits — never the entity's headers, whatever the request says), the final
// check holds each cell to its type and to the table's "required" mode, a submitted version never changes, and "Convert to Table" turns the old competitive-analysis group into a table (drafts
// migrated, applicants told when an answer could not be carried over, submissions untouched, a confirmation when there are submissions).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const sent: { to: string; subject: string; text?: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({
  ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true,
  sendTransactionalEmail: async (o: { to: string; subject: string; text?: string }) => { sent.push({ to: o.to, subject: o.subject, text: o.text }); return { sent: true }; },
}));

import { POST as createPost } from './route';
import { GET as oneGet } from './[id]/route';
import { PUT as formPut } from './[id]/form/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as convertPost } from './[id]/form/convert-to-table/route';
import { POST as startPost } from './apply/[token]/start/route';
import { PUT as appPut } from './apply/applications/[id]/route';
import { POST as submitPost } from './apply/applications/[id]/submit/route';
import { newField } from '@/lib/calls/form-builder';
import { defaultTableConfig } from '@/lib/calls/table';
import type { FormField, TableConfig } from '@/lib/calls/types';

const FIRM = '11111111-1111-4111-8111-111111111111';
const STARTUP = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'tok-table-0123456789abcd';
const DAY = 86_400_000;
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

const NAME = 'f0000000-0000-4000-8000-0000000000aa';
const TBL = 'f0000000-0000-4000-8000-0000000000bb';
/** The competitive-analysis table of the INNOV-ID form, as the entity builds it. */
const competitors = (over: Partial<TableConfig> = {}): TableConfig => ({
  cornerTitle: 'Relevant Criteria',
  rows: [{ id: 'r_prod', label: 'Products & Services' }, { id: 'r_biz', label: 'Business Model' }, { id: 'r_share', label: 'Market Share (%)' }],
  columns: [{ id: 'c_you', label: 'Your solution/company' }, { id: 'c_1', label: 'Competitor #1' }, { id: 'c_2', label: 'Competitor #2' }],
  cellKind: 'short_text', rowKinds: { r_share: 'percent' },
  addColumns: { allowed: true, max: 5, defaultName: 'Competitor #' }, addRows: { allowed: false, max: 3, defaultName: 'Row #' },
  required: 'none', ...over,
});
const tableField = (cfg: TableConfig, over: Partial<FormField> = {}): FormField => ({ ...newField('table', 1, 1), id: TBL, label: 'Competitive analysis', validations: { table: cfg }, ...over });
const nameField = (): FormField => ({ ...newField('short_text', 1, 0), id: NAME, label: 'Startup name', required: false });

const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const fieldRow = () => db.tables.call_form_fields.find((f) => f.id === TBL)!;
const cfgNow = () => (fieldRow().validations as { table: TableConfig }).table;
const version = async (id: string) => (await read(await oneGet(json('GET'), params(id)))).body.call.configVersion as number;
async function newCall(cfg: TableConfig = competitors(), over: Partial<FormField> = {}) {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Table Call' })));
  expect(created.status).toBe(200);
  const id = created.body.call.id as string;
  const saved = await read(await formPut(json('PUT', { baseVersion: await version(id), fields: [nameField(), tableField(cfg, over)] }), params(id)));
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return id;
}
const open = (id: string) => Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString(), closes_at: new Date(Date.now() + 30 * DAY).toISOString(), link_token: TOKEN });
async function draft(user = 'founder-a') {
  as(user);
  const s = await read(await startPost(json('POST', {}), { params: { token: TOKEN } }));
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return s.body.state.application as { id: string; revision: number };
}
const save = (appId: string, revision: number, answers: Record<string, unknown>) => appPut(json('PUT', { answers, lastPage: 1, baseRevision: revision }), params(appId)).then(read);
const stored = (appId: string) => (db.tables.call_applications.find((a) => a.id === appId)!.draft_answers as Record<string, unknown>)[TBL] as { columns: { id: string; name: string; addedBy: string }[]; rows: unknown[]; cells: Record<string, Record<string, string>> } | undefined;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; sent.length = 0;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.orgs.push({ id: STARTUP, name: 'Startup One', is_test: false });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  for (const u of ['founder-a', 'founder-b']) { db.users.set(u, { id: u, email: `${u}@example.com` }); db.tables.org_members.push({ org_id: STARTUP, user_id: u, role: 'owner', full_name: u }); }
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the editor saves a table, and the server refuses what cannot be filled in', () => {
  it('saves the whole configuration and returns it as saved — headers, per-row types, add rules, required mode', async () => {
    const id = await newCall();
    expect(db.tables.call_form_fields.filter((f) => f.call_id === id).map((f) => f.kind)).toEqual(['short_text', 'table']);
    expect(cfgNow()).toMatchObject({ cornerTitle: 'Relevant Criteria', cellKind: 'short_text', rowKinds: { r_share: 'percent' }, addColumns: { allowed: true, max: 5, defaultName: 'Competitor #' }, required: 'none' });
    expect(cfgNow().rows.map((r) => r.label)).toEqual(['Products & Services', 'Business Model', 'Market Share (%)']);
    expect(cfgNow().columns.map((c) => c.id)).toEqual(['c_you', 'c_1', 'c_2']);
  });

  it('refuses a table with no column, or no row and no way to add one, or a table in a condition', async () => {
    as('ana');
    const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Bad' })));
    const id = created.body.call.id as string;
    const put = async (fields: unknown[]) => read(await formPut(json('PUT', { baseVersion: await version(id), fields }), params(id)));
    expect((await put([tableField(competitors({ columns: [] }))])).status).toBe(400);
    expect((await put([tableField(competitors({ rows: [], addRows: { allowed: false, max: 1, defaultName: 'Row #' } }))])).status).toBe(400);
    const dependent = { ...nameField(), condition: { fieldId: TBL, operator: 'is_answered', value: null } };
    expect((await put([tableField(competitors()), { ...dependent, position: 2 }])).status).toBe(400);
    expect(db.tables.call_form_fields.filter((f) => f.call_id === id)).toHaveLength(0);
  });

  it('duplicating the call copies the configuration', async () => {
    const id = await newCall();
    as('ana');
    const copy = await read(await duplicatePost(json('POST'), params(id)));
    expect(copy.status).toBe(200);
    const copied = db.tables.call_form_fields.find((f) => f.call_id === copy.body.call.id && f.kind === 'table')!;
    expect(copied.validations).toEqual(fieldRow().validations);
    expect(copied.id).not.toBe(TBL);
  });

  it('the readiness check names a table that cannot be filled in', async () => {
    const id = await newCall(competitors());
    (fieldRow().validations as { table: TableConfig }).table.columns[0].label = '';
    as('ana');
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(JSON.stringify(state.body.issues)).toContain('a table');
  });
});

describe('the applicant authors only what they are allowed to — whatever the request says', () => {
  it('keeps their own column and the cells; the entity\'s headers, unknown columns and rows, and rows when not allowed never survive', async () => {
    const id = await newCall(); open(id);
    const a = await draft();
    const evil = {
      columns: [{ id: 'c_you', name: 'HACKED', addedBy: 'applicant' }, { id: 'x_comp00003', name: 'Competitor #3', addedBy: 'applicant' }],
      rows: [{ id: 'x_row000001', name: 'Sneaky criterion', addedBy: 'applicant' }, { id: 'r_prod', name: 'HACKED ROW', addedBy: 'applicant' }],
      cells: { r_prod: { c_you: 'ours', c_1: 'theirs', x_comp00003: 'third', nope: 'ghost' }, ghost: { c_you: 'ghost row' }, x_row000001: { c_you: 'sneaky' } },
    };
    const r = await save(a.id, a.revision, { [TBL]: evil });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(stored(a.id)).toEqual({ columns: [{ id: 'x_comp00003', name: 'Competitor #3', addedBy: 'applicant' }], rows: [], cells: { r_prod: { c_you: 'ours', c_1: 'theirs', x_comp00003: 'third' } } });
    // the entity's configuration is not something an application can touch
    expect(cfgNow().columns.map((c) => c.label)).toEqual(['Your solution/company', 'Competitor #1', 'Competitor #2']);
    expect(cfgNow().rows.map((x) => x.label)).toEqual(['Products & Services', 'Business Model', 'Market Share (%)']);
  });

  it('respects the maximum, counting the entity\'s own columns (3 of 5: two more at most)', async () => {
    const id = await newCall(); open(id);
    const a = await draft();
    const extra = (n: number) => ({ id: `x_extra${n}000`, name: `Competitor #${n + 3}`, addedBy: 'applicant' });
    await save(a.id, a.revision, { [TBL]: { columns: [extra(1), extra(2), extra(3)], rows: [], cells: { r_prod: { c_you: 'x' } } } });
    expect(stored(a.id)!.columns.map((c) => c.id)).toEqual(['x_extra1000', 'x_extra2000']);
  });

  it('with the right to add rows, their rows are kept up to the maximum; a column or row left empty is not an answer', async () => {
    const id = await newCall(competitors({ addRows: { allowed: true, max: 4, defaultName: 'Criterion #' } })); open(id);
    const a = await draft();
    await save(a.id, a.revision, { [TBL]: { columns: [], rows: [{ id: 'x_row000001', name: 'Team size', addedBy: 'applicant' }, { id: 'x_row000002', name: 'Again', addedBy: 'applicant' }], cells: { x_row000001: { c_you: '12' } } } });
    expect(stored(a.id)!.rows).toMatchObject([{ id: 'x_row000001', name: 'Team size' }]);                      // 3 of 4: one more at most
    expect(stored(a.id)!.cells).toEqual({ x_row000001: { c_you: '12' } });
    const b = await draft('founder-b');                                                                          // same startup: the same draft
    expect(b.id).toBe(a.id);
  });

  it('a cell is coerced to the type of its row (digits only for a number; a percentage keeps what is valid so far)', async () => {
    const id = await newCall(competitors({ rowKinds: { r_share: 'percent', r_biz: 'number' } })); open(id);
    const a = await draft();
    await save(a.id, a.revision, { [TBL]: { columns: [], rows: [], cells: { r_biz: { c_you: '12abc34' }, r_share: { c_you: '45,5', c_1: 'lots' } } } });
    expect(stored(a.id)!.cells).toEqual({ r_biz: { c_you: '1234' }, r_share: { c_you: '45.5' } });
  });
});

describe('the final check: required mode and cell types', () => {
  const failures = (r: { body: { failures?: { fieldId: string; message?: string }[] } }) => (r.body.failures ?? []).filter((f) => f.fieldId === TBL);

  it('"all": every cell of the entity\'s columns is asked for — one item per missing cell — and the applicant\'s own columns never are', async () => {
    const id = await newCall(competitors({ required: 'all' })); open(id);
    const a = await draft();
    await save(a.id, a.revision, { [TBL]: { columns: [{ id: 'x_comp00003', name: 'Competitor #3', addedBy: 'applicant' }], rows: [], cells: { r_prod: { c_you: 'ours' } } } });
    const r = await read(await submitPost(json('POST', { key: 'key-0001-aaaa', baseRevision: a.revision + 1 }), params(a.id)));
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body.failures)).toContain('Products & Services — Competitor #1');
    expect(JSON.stringify(r.body.failures)).not.toContain('Competitor #3: This answer');
    expect(db.tables.call_application_submissions).toHaveLength(0);
  });

  it('a percentage above 100 is refused with its row and column; once fixed, and with every required cell in, it submits', async () => {
    const id = await newCall(competitors({ required: 'first_column' })); open(id);
    const a = await draft();
    const cells = (share: string) => ({ r_prod: { c_you: 'a' }, r_biz: { c_you: 'b' }, r_share: { c_you: share } });
    const bad = await save(a.id, a.revision, { [TBL]: { columns: [], rows: [], cells: cells('150') } });
    const refused = await read(await submitPost(json('POST', { key: 'key-0002-aaaa', baseRevision: bad.body.revision }), params(a.id)));
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body.failures)).toMatch(/Market Share \(%\) — Your solution\/company: Enter a percentage between 0 and 100\./);
    const good = await save(a.id, bad.body.revision, { [TBL]: { columns: [], rows: [], cells: cells('45') } });
    const ok = await read(await submitPost(json('POST', { key: 'key-0003-aaaa', baseRevision: good.body.revision }), params(a.id)));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('a required question with no cell filled in asks for one', async () => {
    const id = await newCall(competitors(), { required: true }); open(id);
    const a = await draft();
    const r = await read(await submitPost(json('POST', { key: 'key-0004-aaaa', baseRevision: a.revision }), params(a.id)));
    expect(r.status).toBe(409);
    expect(failures(r as never).length).toBeGreaterThan(0);
  });

  it('the submitted version is immutable: the form as it was, and the answers, stay when the entity changes the table afterwards', async () => {
    const id = await newCall(); open(id);
    const a = await draft();
    const saved = await save(a.id, a.revision, { [TBL]: { columns: [{ id: 'x_comp00003', name: 'Competitor #3', addedBy: 'applicant' }], rows: [], cells: { r_prod: { c_you: 'ours', x_comp00003: 'third' } } } });
    const ok = await read(await submitPost(json('POST', { key: 'key-0005-aaaa', baseRevision: saved.body.revision }), params(a.id)));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const before = JSON.stringify(db.tables.call_application_submissions[0]);
    // the entity edits the configuration (here directly, as the lock does not apply to what is stored)
    // (replaced as a whole, the way an UPDATE does: the fake database shares object references between rows, a real one stores a copy)
    const cfg = structuredClone(cfgNow()); cfg.columns[0].label = 'RENAMED LATER'; cfg.rows.pop(); cfg.addColumns.allowed = false;
    fieldRow().validations = { table: cfg };
    expect(JSON.stringify(db.tables.call_application_submissions[0])).toBe(before);
    const snap = db.tables.call_application_submissions[0].form_snapshot as { fields: { id: string; validations: { table?: TableConfig } }[] };
    expect(snap.fields.find((f) => f.id === TBL)!.validations.table!.columns[0].label).toBe('Your solution/company');
    expect(db.tables.call_application_submissions[0].answers).toMatchObject({ [TBL]: { columns: [{ id: 'x_comp00003' }], cells: { r_prod: { c_you: 'ours', x_comp00003: 'third' } } } });
  });
});

describe('Convert to Table — the old competitive-analysis group', () => {
  const GROUP = 'f0000000-0000-4000-8000-0000000000cc';
  const SUB = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'];
  const oldGroup = (): FormField => ({ ...newField('group', 1, 1), id: GROUP, label: 'Competitive Detailed Analysis', validations: { group: {
    entryLabel: 'Company', min: 3, max: 3, display: 'table', presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']],
    subFields: [
      { id: SUB[0], kind: 'short_text', label: 'Company', required: false, options: [], validations: {} },
      { id: SUB[1], kind: 'long_text', label: 'Products & Services', required: false, options: [], validations: {} },
      { id: SUB[2], kind: 'number', label: 'Market Share', required: false, options: [], validations: {} },
    ],
  } } });
  async function groupCall() {
    as('ana');
    const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Old Group' })));
    const id = created.body.call.id as string;
    await read(await formPut(json('PUT', { baseVersion: await version(id), fields: [nameField(), oldGroup()] }), params(id)));
    open(id);
    return id;
  }
  const convert = (id: string, body: Record<string, unknown> = { fieldId: GROUP }) => { as('ana'); return convertPost(json('POST', body), params(id)).then(read); };
  const groupDraft = (user: string, entries: unknown, status: 'draft' | 'submitted' = 'draft') => {
    const appId = `00000000-0000-4000-8000-${String(db.tables.call_applications.length + 1).padStart(12, '0')}`;
    db.tables.call_applications.push({ id: appId, call_id: [...db.tables.calls].pop()!.id, status, startup_org_id: STARTUP, applicant_user_id: user, draft_answers: { [GROUP]: entries }, draft_revision: 0, reference: `REF-${appId.slice(-3)}`, unit_key: `org:${STARTUP}:${appId}`, updated_at: new Date().toISOString(), submitted_at: status === 'submitted' ? new Date().toISOString() : null });
    return appId;
  };

  it('turns the group into a table, transposed — the fixed rows become columns, the questions become criteria, applicants may add columns — keeping the question\'s id, text and place', async () => {
    const id = await groupCall();
    const r = await convert(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const f = db.tables.call_form_fields.find((x) => x.id === GROUP)!;
    expect(f).toMatchObject({ kind: 'table', label: 'Competitive Detailed Analysis' });
    const t = (f.validations as { table: TableConfig }).table;
    expect(t.columns.map((c) => c.label)).toEqual(['Your company', 'Competitor 1', 'Competitor 2']);
    expect(t.rows.map((x) => x.label)).toEqual(['Products & Services', 'Market Share']);
    expect(t.rowKinds).toEqual({ [SUB[1]]: 'long_text', [SUB[2]]: 'number' });
    expect(t.addColumns.allowed).toBe(true);
    expect(db.tables.call_events.some((e) => e.call_id === id && e.event === 'field_converted_to_table')).toBe(true);
  });

  it('migrates the drafts (the entries become the columns); a draft whose answer cannot be carried over is told which question changed', async () => {
    const id = await groupCall();
    const carried = groupDraft('founder-a', [{ id: 'row1', values: { [SUB[0]]: 'Your company', [SUB[1]]: 'We build things', [SUB[2]]: '12' } }, { id: 'row2', values: { [SUB[1]]: 'They sell things' } }]);
    const orphan = groupDraft('founder-b', [{ id: 'unknown-entry', values: { [SUB[1]]: 'typed against an entry that is gone' } }]);
    const r = await convert(id);
    expect(r.body.converted).toMatchObject({ drafts: 2, migrated: 1, told: 1, submitted: 0 });
    const answerOf = (a: string) => (db.tables.call_applications.find((x) => x.id === a)!.draft_answers as Record<string, unknown>)[GROUP];
    expect(answerOf(carried)).toEqual({ columns: [], rows: [], cells: { [SUB[1]]: { row1: 'We build things', row2: 'They sell things' }, [SUB[2]]: { row1: '12' } } });
    expect(answerOf(orphan)).toBeUndefined();
    expect(db.tables.call_applications.every((a) => Number(a.draft_revision) === 1)).toBe(true);        // an application open in another window reloads instead of overwriting
    expect(db.tables.call_notices.filter((n) => n.kind === 'form_changed')).toMatchObject([{ user_id: 'founder-b', application_id: orphan }]);
    expect(sent.map((m) => m.to)).toEqual(['founder-b@example.com']);
  });

  it('with submissions already in it asks first (409 needs_confirm); with the confirmation it goes through, and the submitted ones are untouched', async () => {
    const id = await groupCall();
    const submitted = groupDraft('founder-a', [{ id: 'row1', values: { [SUB[1]]: 'submitted text' } }], 'submitted');
    const snapshot = JSON.stringify(db.tables.call_applications.find((a) => a.id === submitted));
    const asked = await convert(id);
    expect(asked).toMatchObject({ status: 409, body: { code: 'needs_confirm', submitted: 1 } });
    expect(db.tables.call_form_fields.find((x) => x.id === GROUP)!.kind).toBe('group');
    const done = await convert(id, { fieldId: GROUP, confirm: true });
    expect(done.status).toBe(200);
    expect(JSON.stringify(db.tables.call_applications.find((a) => a.id === submitted))).toBe(snapshot);
  });

  it('refuses what is not a group in table mode with rows set by the entity, and what a member without the right asks', async () => {
    const id = await newCall();                                                                          // the question is already a table
    expect(await convert(id, { fieldId: TBL })).toMatchObject({ status: 409, body: { code: 'not_convertible' } });
    expect((await convert(id, { fieldId: 'no-such-field' })).status).toBe(404);
    db.users.set('bob', { id: 'bob', email: 'bob@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    as('bob');
    expect((await convertPost(json('POST', { fieldId: TBL }), params(id))).status).toBe(403);
  });

  it('the default table the editor offers is fillable (a named column, rows to number) and has no applicant rights', () => {
    const d = defaultTableConfig();
    expect(d.columns.every((c) => c.label)).toBe(true);
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.addColumns.allowed || d.addRows.allowed).toBe(false);
  });
});
