// Prompt 922 (Adenda 1, B) — criteria linked to the questions of the form, and criteria that score themselves from a closed answer, through the real handlers over the stateful fake database:
// the links are saved with the grid and refused when the question is not in THIS call's form; a table of points belongs to one closed question; the evaluator's screen gets the automatic points ("Automatic",
// with the answer that gave them) and cannot change them unless the entity allowed it (then a comment is needed and both values are kept); no answer = scored by hand; the point follows a corrected answer until
// the evaluation is submitted, and afterwards a difference is only a warning for the administrator; a duplicated call and a template keep or drop the links as they should.
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
vi.mock('@/lib/resend', async (orig) => ({ ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true, sendTransactionalEmail: async () => ({ sent: true, id: 'em' }) }));

import { POST as createPost } from './route';
import { GET as evalGet, PUT as evalPut } from './[id]/evaluations/[applicationId]/route';
import { POST as submitPost } from './[id]/evaluations/[applicationId]/submit/route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { POST as templatesPost } from './[id]/eval-grid/templates/route';
import { POST as templateUse } from './[id]/eval-grid/templates/[templateId]/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

let CALL = ''; let APP = '';
const F = { stage: 'f1111111-0000-4000-8000-000000000001', grant: 'f1111111-0000-4000-8000-000000000002', raised: 'f1111111-0000-4000-8000-000000000003', pitch: 'f1111111-0000-4000-8000-000000000004', cert: 'f1111111-0000-4000-8000-000000000005' };
const OPT = { pre: 'o-pre', seed: 'o-seed', a: 'o-a' };
const fieldRow = (callId: string, id: string, kind: string, label: string, page: number, position: number, options: { id: string; label: string }[] = []) =>
  ({ id, call_id: callId, kind, label, page, position, required: false, options, validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null });
const FIELD_ROWS = (callId: string, ids: typeof F = F) => [
  fieldRow(callId, ids.stage, 'single_choice', 'Stage', 1, 0, [{ id: OPT.pre, label: 'Pre-seed' }, { id: OPT.seed, label: 'Seed' }, { id: OPT.a, label: 'Series A' }]),
  fieldRow(callId, ids.grant, 'yes_no', 'Received a grant?', 1, 1),
  fieldRow(callId, ids.raised, 'number', 'Investment received', 2, 0),
  fieldRow(callId, ids.pitch, 'long_text', 'Pitch', 2, 1),
  fieldRow(callId, ids.cert, 'file', 'Certificate', 3, 0),
];

const get = (u: string, appId = APP) => { as(u); return evalGet(json('GET'), { params: { id: CALL, applicationId: appId } }).then(read); };
const put = (u: string, body: unknown) => { as(u); return evalPut(json('PUT', body), { params: { id: CALL, applicationId: APP } }).then(read); };
const submit = (u: string, revision?: number) => { as(u); return submitPost(json('POST', { revision }), { params: { id: CALL, applicationId: APP } }).then(read); };
const grid = async (callId = CALL) => { as('ana'); return gridGet(json('GET'), { params: { id: callId } }).then(read); };
const saveGrid = async (criteria: unknown[], callId = CALL) => { const v = await grid(callId); return gridPut(json('PUT', { baseRev: v.body.rev, criteria, settings: v.body.settings }), { params: { id: callId } }).then(read); };

function firmMember(id: string) { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' }); }
const category = (name: string, perms: Record<string, boolean>) => { const id = `cat-${name}`; db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' }); return id; };
const onTeam = (callId: string, userId: string, categoryId: string) => db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId, permission_overrides: {}, created_at: '2026-01-02T00:00:00.000Z' });
const setAnswers = (answers: Record<string, unknown>) => { db.tables.call_application_submissions.find((s) => s.application_id === APP)!.answers = answers; };

function application(callId: string) {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001'; const sub = 'cccccccc-0000-4000-8000-000000000001'; const org = 'bbbbbbbb-0000-4000-8000-000000000001';
  db.users.set('founder-1', { id: 'founder-1', email: 'joao@acme.pt', user_metadata: { full_name: 'João Ferreira' } } as never);
  db.tables.orgs.push({ id: org, name: 'Acme Robotics, Lda.' });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: 'founder-1', status: 'submitted', reference: 'REF-1', current_submission_id: sub, submitted_at: '2026-10-10T10:00:00Z', draft_answers: {}, created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z' });
  db.tables.call_application_submissions.push({ id: sub, application_id: id, version: 1, submitted_by: 'founder-1', submitted_at: '2026-10-10T10:00:00Z', idempotency_key: 'k1',
    form_snapshot: { fields: FIELD_ROWS(callId).map((r) => ({ id: r.id, kind: r.kind, label: r.label, page: r.page, position: r.position, options: r.options, validations: {}, required: false, instruction: '' })) },
    answers: { [F.stage]: OPT.seed, [F.grant]: 'yes', [F.pitch]: 'A robot that cures things.' }, documents: [] });
  return id;
}

const CRITERIA = [
  { name: 'Stage', weight: 40, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.stage, options: { [OPT.pre]: 1, [OPT.seed]: 3, [OPT.a]: 5 } } },
  { name: 'Grant', weight: 20, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.grant, yes: 5, no: 1, override: true } },
  { name: 'Raised', weight: 20, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.raised, ranges: [{ upTo: 50000, points: 1 }, { upTo: 250000, points: 3 }, { upTo: null, points: 5 }] } },
  { name: 'Pitch', weight: 20, scaleMin: 1, scaleMax: 5, linkedFields: [F.pitch] },
];
let C: Record<string, string>;

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana'); db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Linked Call' })))).body.call.id as string;
  for (const m of db.tables.call_team_members.filter((x) => x.user_id === 'ana')) m.permission_overrides = { evaluate_assigned: false };
  firmMember('rita'); onTeam(CALL, 'rita', category('Evaluator', { evaluate_assigned: true }));
  db.tables.call_form_fields.push(...FIELD_ROWS(CALL));
  APP = application(CALL);
  db.tables.call_eval_assignments.push({ id: 'as-1', call_id: CALL, application_id: APP, evaluator_user_id: 'rita', source: 'auto', status: 'assigned', created_at: '2026-10-11T00:00:00Z' });
  const r = await saveGrid(CRITERIA);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  C = Object.fromEntries((r.body.criteria as { id: string; name: string }[]).map((c) => [c.name, c.id]));
});

describe('the grid: links and tables of points', () => {
  it('are saved with the grid and come back; the view numbers the questions of the form by page', async () => {
    const v = await grid();
    expect(v.body.criteria.find((c: { name: string }) => c.name === 'Pitch')).toMatchObject({ linkedFields: [F.pitch], auto: null });
    expect(v.body.criteria.find((c: { name: string }) => c.name === 'Stage')).toMatchObject({ linkedFields: [F.stage], auto: { fieldId: F.stage, kind: 'single_choice' } });
    expect(v.body.fields.map((f: { number: number; label: string; page: number }) => `${f.number}.${f.label}@${f.page}`)).toEqual(['1.Stage@1', '2.Received a grant?@1', '3.Investment received@2', '4.Pitch@2', '5.Certificate@3']);
    expect(v.body.fields.map((f: { canScore: boolean }) => f.canScore)).toEqual([true, true, true, false, false]);
  });
  it('a link to a question that is not in THIS call is refused; so is a table on a question that cannot score, or points outside the scale', async () => {
    expect((await saveGrid([{ name: 'X', weight: 100, scaleMin: 1, scaleMax: 5, linkedFields: ['11111111-0000-4000-8000-00000000dead'] }])).body.error).toContain('no longer in the form');
    expect((await saveGrid([{ name: 'X', weight: 100, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.pitch } }])).body.error).toContain('cannot score');
    expect((await saveGrid([{ name: 'X', weight: 100, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.grant, yes: 9, no: 1 } }])).body.error).toContain('from 1 to 5');
  });
  it('an incomplete table is saved while it is built, and keeps the call from being validated, in words', async () => {
    const r = await saveGrid([{ name: 'Stage', weight: 100, scaleMin: 1, scaleMax: 5, auto: { fieldId: F.stage, options: { [OPT.pre]: 1 } } }]);
    expect(r.status).toBe(200);
    expect(r.body.problems).toEqual(['“Stage”: give points to the answer “Seed”.', '“Stage”: give points to the answer “Series A”.']);
  });
  it('a link only (no table) changes the grid like any other change: the link is part of the criterion', async () => {
    const v = await grid();
    const same = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: v.body.settings }), { params: { id: CALL } }).then(read);
    expect(same.body.unchanged).toBe(true);
    const moved = v.body.criteria.map((c: { name: string }) => (c.name === 'Pitch' ? { ...c, linkedFields: [F.pitch, F.cert] } : c));
    const r = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: moved, settings: v.body.settings }), { params: { id: CALL } }).then(read);
    expect(r.body.criteria.find((c: { name: string }) => c.name === 'Pitch').linkedFields).toEqual([F.pitch, F.cert]);
  });
});

describe('the evaluator’s screen', () => {
  it('arrives with the automatic points already there, marked automatic with the answer that gave them; no answer needs a manual score', async () => {
    const g = await get('rita');
    expect(g.body.autos[C.Stage]).toMatchObject({ status: 'scored', points: 3, because: 'Seed', override: false, fieldId: F.stage });
    expect(g.body.autos[C.Grant]).toMatchObject({ status: 'scored', points: 5, because: 'Yes', override: true });
    expect(g.body.autos[C.Raised]).toMatchObject({ status: 'missing', points: null });
    expect(g.body.autos[C.Pitch]).toBeUndefined();
    expect(g.body.evaluation.scores[C.Stage]).toMatchObject({ score: 3, source: 'auto', autoValue: 3 });
    expect(g.body.evaluation.scores[C.Raised]).toBeUndefined();
    expect(g.body.grid.criteria.find((c: { name: string }) => c.name === 'Pitch').linkedFields).toEqual([F.pitch]);
  });
  it('by default the evaluator cannot change it (403, nothing written); the comment still can be written', async () => {
    const r = await put('rita', { scores: { [C.Stage]: { score: 5 } } });
    expect(r).toMatchObject({ status: 403, body: { code: 'auto_locked' } });
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Stage)).toBeUndefined();
    expect((await put('rita', { scores: { [C.Stage]: { comment: 'Looks right' } } })).status).toBe(200);
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Stage)).toMatchObject({ score: 3, source: 'auto', auto_value: 3, comment: 'Looks right' });
  });
  it('with the permission the evaluator can change it: both values are kept, and submitting needs the comment', async () => {
    await put('rita', { scores: { [C.Raised]: { score: 2 }, [C.Pitch]: { score: 4 } } });
    const r = await put('rita', { scores: { [C.Grant]: { score: 2 } } });
    expect(r.status).toBe(200);
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Grant)).toMatchObject({ score: 2, source: 'override', auto_value: 5 });
    const early = await submit('rita');
    expect(early).toMatchObject({ status: 422, body: { code: 'incomplete', missing: [{ criterionId: C.Grant, problem: 'comment' }] } });
    await put('rita', { scores: { [C.Grant]: { comment: 'The grant was withdrawn.' } } });
    expect((await submit('rita')).status).toBe(200);
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Grant)).toMatchObject({ score: 2, source: 'override', auto_value: 5, comment: 'The grant was withdrawn.' });
  });
  it('choosing the automatic value again is not an override', async () => {
    await put('rita', { scores: { [C.Grant]: { score: 2, comment: 'x' } } });
    await put('rita', { scores: { [C.Grant]: { score: 5 } } });
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Grant)).toMatchObject({ score: 5, source: 'auto' });
  });
  it('with no answer to score from the evaluator scores by hand, and submitting asks for it', async () => {
    await put('rita', { scores: { [C.Pitch]: { score: 4 } } });
    const early = await submit('rita');
    expect(early).toMatchObject({ status: 422, body: { missing: [{ criterionId: C.Raised, problem: 'score' }] } });
    expect((await put('rita', { scores: { [C.Raised]: { score: 3 } } })).status).toBe(200);
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Raised)).toMatchObject({ score: 3, source: 'manual' });
    expect((await submit('rita')).status).toBe(200);
  });
  it('until it is submitted a corrected answer recalculates the point; after submitting the point is fixed and a difference is only a warning for the administrator', async () => {
    await put('rita', { scores: { [C.Raised]: { score: 3 }, [C.Pitch]: { score: 4 } } });
    expect((await get('rita')).body.evaluation.scores[C.Stage]).toMatchObject({ score: 3 });
    setAnswers({ [F.stage]: OPT.a, [F.grant]: 'yes', [F.pitch]: 'x' });                        // the answer is corrected (for example on the eligibility step)
    expect((await get('rita')).body.evaluation.scores[C.Stage]).toMatchObject({ score: 5, source: 'auto', autoValue: 5 });
    expect((await submit('rita')).status).toBe(200);
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.Stage)).toMatchObject({ score: 5, auto_value: 5 });
    setAnswers({ [F.stage]: OPT.pre, [F.grant]: 'yes', [F.pitch]: 'x' });
    const afterRita = await get('rita');
    expect(afterRita.body.evaluation.scores[C.Stage]).toMatchObject({ score: 5 });             // fixed
    expect(afterRita.body.drift).toEqual([]);                                                  // the evaluator is not shown the warning…
    const afterAna = await get('ana');
    expect(afterAna.status).toBe(200);
    expect(afterAna.body.colleagues[0].drift).toEqual([{ criterionId: C.Stage, name: 'Stage', held: 5, now: 1 }]);   // …the administrator is
  });
  it('the grade counts the automatic points like any other score', async () => {
    const r = await put('rita', { scores: { [C.Raised]: { score: 3 }, [C.Pitch]: { score: 4 } } });
    // Stage 3 (40 %) → 50 %, Grant 5 (20 %) → 100 %, Raised 3 (20 %) → 50 %, Pitch 4 (20 %) → 75 %  =  0.4·50 + 0.2·100 + 0.2·50 + 0.2·75 = 65
    expect(r.body.gradePercent).toBe(65);
  });
});

describe('a duplicated call and a template', () => {
  it('a duplicated call keeps the links and the tables, pointing to the questions of the COPY', async () => {
    as('ana');
    const copy = (await read(await duplicatePost(json('POST'), { params: { id: CALL } }))).body.call.id as string;
    const newFields = db.tables.call_form_fields.filter((f) => f.call_id === copy);
    const idOf = (label: string) => newFields.find((f) => f.label === label)!.id as string;
    expect(idOf('Stage')).not.toBe(F.stage);
    const v = await grid(copy);
    expect(v.body.criteria.find((c: { name: string }) => c.name === 'Stage')).toMatchObject({ linkedFields: [idOf('Stage')], auto: { fieldId: idOf('Stage'), options: { [OPT.seed]: 3 } } });
    expect(v.body.criteria.find((c: { name: string }) => c.name === 'Pitch').linkedFields).toEqual([idOf('Pitch')]);
  });
  it('a template used in a call whose form is different gets criteria with NO links and the notice; in the same form the links stay', async () => {
    as('ana');
    const t = (await read(await templatesPost(json('POST', { name: 'Linked grid' }), { params: { id: CALL } }))).body;
    const other = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
    db.tables.call_form_fields.push(fieldRow(other, 'f2222222-0000-4000-8000-000000000001', 'long_text', 'Something else', 1, 0));
    const here = await templateUse(json('POST'), { params: { id: other, templateId: t.id } }).then(read);
    expect(here.status).toBe(200);
    expect(here.body.criteria.every((c: { linkedFields: string[]; auto: unknown }) => c.linkedFields.length === 0 && c.auto === null)).toBe(true);
    expect(here.body.criteria.filter((c: { linkNotice: boolean }) => c.linkNotice).map((c: { name: string }) => c.name)).toEqual(['Stage', 'Grant', 'Raised', 'Pitch']);
    const same = await templateUse(json('POST'), { params: { id: CALL, templateId: t.id } }).then(read);
    expect(same.body.criteria.find((c: { name: string }) => c.name === 'Stage')).toMatchObject({ linkedFields: [F.stage], linkNotice: false, auto: { fieldId: F.stage } });
  });
});
