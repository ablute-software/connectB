// Prompt 922 (I3) — the evaluator's side, through the real handlers over the stateful fake database, AND the permissions enforced against the API itself (what the browser hides is refused here):
// "My evaluations" lists only what is the person's; an evaluator opens only an application assigned to them (403 otherwise) and an administrator any; the application leaves the server MASKED when the evaluation is
// blind (the startup, the people, the emails, the file names — the files still open); documents stream through the platform with no Storage address; autosave with revisions; scores validated against the scale
// of the grid version the evaluation started on; submit needs every score and the required comments (422 with the list), then it is read-only; only an administrator reopens, with a reason kept with what was there;
// colleagues' evaluations need the permission AND one's own submitted; the private note is for administrators; a closed evaluation accepts nothing; each call is isolated.
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
import { POST as reopenPost } from './[id]/evaluations/[applicationId]/reopen/route';
import { GET as docGet } from './[id]/evaluations/[applicationId]/documents/[fileId]/route';
import { GET as mineGet } from './my-evaluations/route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

let CALL = ''; let CALL_B = '';
let APP = ''; let APP_B = '';
let C: { team: string; market: string; tech: string };
const P = (callId: string, appId: string) => ({ params: { id: callId, applicationId: appId } });
const get = (u: string | null, callId = CALL, appId = APP) => { as(u); return evalGet(json('GET'), P(callId, appId)).then(read); };
const put = (u: string, body: unknown, callId = CALL, appId = APP) => { as(u); return evalPut(json('PUT', body), P(callId, appId)).then(read); };
const submit = (u: string, revision?: number, callId = CALL, appId = APP) => { as(u); return submitPost(json('POST', { revision }), P(callId, appId)).then(read); };
const mine = (u: string | null) => { as(u); return mineGet().then(read); };
const evalRow = (u: string, appId = APP) => db.tables.call_evaluations.find((e) => e.application_id === appId && e.evaluator_user_id === u);
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);

function firmMember(id: string, email = `${id}@${id}.test`) {
  db.users.set(id, { id, email });
  db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
}
const category = (name: string, perms: Record<string, boolean>) => { const id = `cat-${name}-${db.tables.call_team_categories.length}`; db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' }); return id; };
const onTeam = (callId: string, userId: string, categoryId: string, overrides: Record<string, boolean> = {}) => db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId, permission_overrides: overrides, created_at: '2026-01-02T00:00:00.000Z' });
const assign = (callId: string, appId: string, userId: string) => db.tables.call_eval_assignments.push({ id: `as-${appId.slice(-4)}-${userId}`, call_id: callId, application_id: appId, evaluator_user_id: userId, source: 'auto', status: 'assigned', created_at: '2026-10-20T00:00:00Z' });

const STARTUP = 'Acme Robotics, Lda.';
function application(callId: string, tag: string) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`;
  const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`;
  const sub = `cccccccc-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(`founder-${tag}`, { id: `founder-${tag}`, email: 'joao@acme.pt', user_metadata: { full_name: 'João Ferreira' } } as never);
  db.tables.orgs.push({ id: org, name: STARTUP });
  db.tables.org_members.push({ org_id: org, user_id: `founder-${tag}` });
  const fieldIds = { name: `10000000-0000-4000-8000-${tag.padStart(12, '0')}`, mail: `20000000-0000-4000-8000-${tag.padStart(12, '0')}`, pitch: `30000000-0000-4000-8000-${tag.padStart(12, '0')}`, cert: `40000000-0000-4000-8000-${tag.padStart(12, '0')}` };
  const fields = [
    { id: fieldIds.name, label: 'Company name', kind: 'short_text', page: 1, position: 0, options: [], validations: {}, required: false, instruction: '' },
    { id: fieldIds.mail, label: 'Contact email', kind: 'email', page: 1, position: 1, options: [], validations: {}, required: false, instruction: '' },
    { id: fieldIds.pitch, label: 'Pitch', kind: 'long_text', page: 1, position: 2, options: [], validations: {}, required: false, instruction: '' },
    { id: fieldIds.cert, label: 'Permanent Certificate', kind: 'file', page: 2, position: 0, options: [], validations: {}, required: false, instruction: '' },
  ];
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `founder-${tag}`, status: 'submitted', reference: `REF-${tag}`, current_submission_id: sub, submitted_at: '2026-10-10T10:00:00Z', draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  const path = `calls/${callId}/${id}/certidao-acme-robotics-lda.pdf`;
  storage.objects.set(path, { bytes: new Uint8Array([37, 80, 68, 70, 45, 49]), contentType: 'application/pdf' });
  db.tables.call_application_submissions.push({ id: sub, application_id: id, version: 1, submitted_by: `founder-${tag}`, submitted_at: '2026-10-10T10:00:00Z', idempotency_key: `k-${tag}`, form_snapshot: { fields },
    answers: { [fieldIds.name]: STARTUP, [fieldIds.mail]: 'joao@acme.pt', [fieldIds.pitch]: 'João Ferreira built Acme Robotics to cure things. Contact: joao@acme.pt.', [fieldIds.cert]: [{ fileId: `file-${tag}`, fileName: 'certidao-acme-robotics-lda.pdf', size: 6 }] },
    documents: [{ fieldId: fieldIds.cert, fileId: `file-${tag}`, source: 'upload', fileName: 'certidao-acme-robotics-lda.pdf', size: 6, sha256: null, frozenPath: path, documentId: null, versionId: null, versionNumber: null }] });
  return { id, fieldIds, fileId: `file-${tag}`, path };
}

const setGrid = async (callId: string, settings: Record<string, unknown> = {}) => {
  as('ana');
  const v = await gridGet(json('GET'), { params: { id: callId } }).then(read);
  const criteria = [
    { name: 'Team', weight: 50, scaleMin: 1, scaleMax: 5, levels: [{ from: 1, text: 'weak' }, { from: 5, text: 'excellent team' }], minScore: 2, guidance: 'Look at the founders.' },
    { name: 'Market', weight: 30, scaleMin: 1, scaleMax: 5, commentRequired: true },
    { name: 'Tech', weight: 20, scaleMin: 0, scaleMax: 10 },
  ];
  const r = await gridPut(json('PUT', { baseRev: v.body.rev, criteria, settings: { ...v.body.settings, ...settings } }), { params: { id: callId } }).then(read);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.criteria as { id: string; name: string }[];
};

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana'); db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Evaluated Call' })))).body.call.id as string;
  CALL_B = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  for (const m of db.tables.call_team_members.filter((x) => x.user_id === 'ana')) m.permission_overrides = { evaluate_assigned: false };
  const evaluator = category('Evaluator', { evaluate_assigned: true });
  const senior = category('Senior', { evaluate_assigned: true, view_colleagues_evaluations: true });
  for (const id of ['rita', 'bruno']) { firmMember(id); onTeam(CALL, id, evaluator); }
  firmMember('sara'); onTeam(CALL, 'sara', senior);
  firmMember('reader'); onTeam(CALL, 'reader', category('Reader', { view_all_applications: true }));
  const a = application(CALL, '1'); APP = a.id;
  const b = application(CALL_B, '2'); APP_B = b.id;
  const crit = await setGrid(CALL);
  C = { team: crit[0].id, market: crit[1].id, tech: crit[2].id };
  assign(CALL, APP, 'rita'); assign(CALL, APP, 'sara');
});

describe('who can open an evaluation — enforced by the server', () => {
  it('an evaluator opens only an application ASSIGNED to them (403 otherwise); an administrator any; a reader, a stranger and the signed-out nothing', async () => {
    expect((await get('rita')).status).toBe(200);
    expect(await get('bruno')).toMatchObject({ status: 403, body: { error: 'This application is not assigned to you.' } });
    expect((await get('reader')).status).toBe(403);
    expect((await get('ana')).status).toBe(200);
    db.users.set('stranger', { id: 'stranger', email: 'stranger@x.test' }); expect([403, 404]).toContain((await get('stranger')).status);        // not even in the organisation of the call: refused either way
    expect((await get(null)).status).toBe(401);
    expect((await get('rita', CALL, 'aaaaaaaa-0000-4000-8000-999999999999')).status).toBe(404);   // an application that does not exist
    expect((await get('rita', CALL_B, APP_B)).status).toBe(403);                                  // another call of the same organisation: she is not on its team, so nothing is assigned to her
  });

  it('losing the permission "Evaluate assigned applications" closes it even though the assignment stays; a draft application is never reachable', async () => {
    db.tables.call_team_members.find((m) => m.user_id === 'rita' && m.call_id === CALL)!.permission_overrides = { evaluate_assigned: false };
    expect((await get('rita')).status).toBe(403);
    expect((await put('rita', { scores: { [C.team]: { score: 3 } } })).status).toBe(403);
    expect((await submit('rita')).status).toBe(403);
    db.tables.call_team_members.find((m) => m.user_id === 'rita' && m.call_id === CALL)!.permission_overrides = {};
    db.tables.call_applications.find((a) => a.id === APP)!.status = 'draft';
    expect((await get('rita')).status).toBe(404);
  });

  it('every write is refused for someone it is not assigned to — an administrator reads but does not score what is not theirs', async () => {
    expect((await put('bruno', { scores: { [C.team]: { score: 3 } } })).status).toBe(403);
    expect((await put('ana', { scores: { [C.team]: { score: 3 } } })).status).toBe(403);
    expect((await submit('bruno')).status).toBe(403);
    expect(db.tables.call_evaluations).toHaveLength(0);
  });
});

describe('the application the evaluator reads', () => {
  it('not blind: the answers and the files as submitted; the grid with the version it started on', async () => {
    const r = await get('rita');
    expect(r.body).toMatchObject({ role: 'evaluator', canEdit: true, blind: false, application: { reference: 'REF-1', startupName: STARTUP }, grid: { version: 1 }, evaluation: { status: 'not_started', revision: 0 } });
    expect(r.body.grid.criteria.map((c: { name: string }) => c.name)).toEqual(['Team', 'Market', 'Tech']);
    expect(Object.values(r.body.answers)).toContain('joao@acme.pt');
    expect(r.body.documents[0]).toMatchObject({ fileName: 'certidao-acme-robotics-lda.pdf', url: expect.stringContaining(`/api/calls/${CALL}/evaluations/${APP}/documents/`) });
    expect(JSON.stringify(r.body)).not.toContain('storage.test');
  });

  it('BLIND: the startup, the people, the emails and the file names are masked ON THE SERVER; the files still open; the administrator sees everything', async () => {
    await setGrid(CALL, { blind: true });
    const r = await get('rita');
    expect(r.body.blind).toBe(true);
    expect(r.body.application.startupName).toBeNull();
    const text = JSON.stringify(r.body);
    for (const leak of ['Acme', 'acme', 'João', 'Ferreira', 'joao@', STARTUP]) expect(text, `leaked: ${leak}`).not.toContain(leak);
    expect(Object.values(r.body.answers)).toContain('[hidden]');
    expect(r.body.answers[Object.keys(r.body.answers)[2]]).toBe('[hidden] built [hidden] to cure things. Contact: [hidden].');
    expect(r.body.documents[0].fileName).toBe('Permanent Certificate — document 1.pdf');
    const file = await docGet(json('GET'), { params: { id: CALL, applicationId: APP, fileId: r.body.documents[0].fileId } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain(encodeURIComponent('Permanent Certificate — document 1.pdf'));
    expect(file.headers.get('content-disposition')).not.toContain('acme');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70, 45, 49]));            // the content is intact
    const admin = await get('ana');
    expect(admin.body).toMatchObject({ blind: false, role: 'admin', application: { startupName: STARTUP } });
    expect(JSON.stringify(admin.body)).toContain('joao@acme.pt');
    // the list never names the startup either
    expect((await mine('rita')).body.calls[0].items[0].startupName).toBeNull();
  });

  it('a document streams through the platform: inline for a PDF, with no Storage address and no redirect; only for who may open the application', async () => {
    const fileId = `file-1`;
    const ok = await docGet(json('GET'), { params: { id: CALL, applicationId: APP, fileId } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(ok.headers.get('location')).toBeNull();
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    as('bruno');
    expect((await docGet(json('GET'), { params: { id: CALL, applicationId: APP, fileId } })).status).toBe(403);
    as('rita');
    expect((await docGet(json('GET'), { params: { id: CALL, applicationId: APP, fileId: 'nope' } })).status).toBe(404);
    db.tables.call_application_submissions[0].documents = [{ ...(db.tables.call_application_submissions[0].documents as Record<string, unknown>[])[0], fileName: 'evil.html' }];
    const html = await docGet(json('GET'), { params: { id: CALL, applicationId: APP, fileId } });
    expect(html.headers.get('content-type')).toBe('application/octet-stream');
    expect(html.headers.get('content-disposition')).toMatch(/^attachment;/);                                      // never rendered in the platform's origin
  });
});

describe('scoring, autosave and submitting', () => {
  it('the first save starts the evaluation on the grid version in force; only what is sent changes; the grade follows; each save has a revision', async () => {
    const a = await put('rita', { revision: 0, scores: { [C.team]: { score: 5 } } });
    expect(a).toMatchObject({ status: 200, body: { ok: true, revision: 1, gradePercent: null } });
    expect(evalRow('rita')).toMatchObject({ grid_version: 1, status: 'in_progress', revision: 1 });
    expect(events('eval_started')).toHaveLength(1);
    const b = await put('rita', { revision: 1, scores: { [C.market]: { score: 3, comment: 'Crowded but growing.' }, [C.tech]: { score: 10 } }, overallComment: 'Promising.', privateNote: 'Ask about IP.' });
    expect(b.body).toMatchObject({ revision: 2, gradePercent: 85 });            // Team 5/5 = 100 %, Market 3/5 on 1–5 = 50 %, Tech 10/10 = 100 %  →  50 + 15 + 20
    const back = await get('rita');
    expect(back.body.evaluation).toMatchObject({ status: 'in_progress', revision: 2, overallComment: 'Promising.', privateNote: 'Ask about IP.', gradePercent: 85 });
    expect(back.body.evaluation.scores[C.market]).toEqual({ score: 3, comment: 'Crowded but growing.' });
    // a score cleared is cleared; a comment alone is allowed
    await put('rita', { revision: 2, scores: { [C.tech]: { score: null } } });
    expect((await get('rita')).body.evaluation).toMatchObject({ gradePercent: null });
    expect(db.tables.call_eval_scores.filter((s) => s.criterion_id === C.tech)).toHaveLength(0);
  });

  it('refuses what does not fit the scale or the grid, with the sentence; and two windows never overwrite each other silently (conflict)', async () => {
    expect((await put('rita', { scores: { [C.team]: { score: 6 } } })).body.error).toBe('A score for “Team” must be a whole number from 1 to 5.');
    expect((await put('rita', { scores: { [C.team]: { score: 2.5 } } })).status).toBe(400);
    expect((await put('rita', { scores: { [C.tech]: { score: -1 } } })).status).toBe(400);
    expect((await put('rita', { scores: { 'not-a-criterion': { score: 1 } } })).body.error).toContain('does not belong to this grid');
    expect((await put('rita', { scores: { [C.team]: { comment: 'x'.repeat(2001) } } })).status).toBe(400);
    expect((await put('rita', null as never)).status).toBe(400);
    await put('rita', { revision: 0, scores: { [C.team]: { score: 4 } } });                      // → revision 1
    const stale = await put('rita', { revision: 0, scores: { [C.team]: { score: 1 } } });
    expect(stale).toMatchObject({ status: 409, body: { code: 'conflict', revision: 1 } });
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.team)!.score).toBe(4);   // the second window did not overwrite
  });

  it('submit needs every score and the required comments (the criterion\'s own or the grid\'s "required for all"): 422 with exactly what is missing', async () => {
    await put('rita', { scores: { [C.team]: { score: 4 }, [C.market]: { score: 3 } } });
    const r = await submit('rita');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('incomplete');
    expect(r.body.missing).toEqual([{ criterionId: C.market, name: 'Market', problem: 'comment' }, { criterionId: C.tech, name: 'Tech', problem: 'score' }]);
    expect(r.body.error).toBe('Before submitting: score the 1 criterion still without a score and write the 1 comment that is required.');
    expect(evalRow('rita')!.status).toBe('in_progress');
    await put('rita', { scores: { [C.market]: { comment: 'Fine.' }, [C.tech]: { score: 7 } } });
    expect((await submit('rita')).status).toBe(200);
  });

  it('"comment required for all" (set before any evaluation starts): every criterion needs a comment, and the grid says so', async () => {
    await setGrid(CALL, { commentRequiredForAll: true });
    await put('rita', { scores: { [C.team]: { score: 4 }, [C.market]: { score: 3, comment: 'ok' }, [C.tech]: { score: 7 } } });
    expect((await submit('rita')).body.missing).toEqual([{ criterionId: C.team, name: 'Team', problem: 'comment' }, { criterionId: C.tech, name: 'Tech', problem: 'comment' }]);
    expect((await get('rita')).body.grid.commentRequiredForAll).toBe(true);
    as('ana');
    const v = await gridGet(json('GET'), { params: { id: CALL } }).then(read);
    expect((await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: { ...v.body.settings, commentRequiredForAll: false } }), { params: { id: CALL } }).then(read)).body.code).toBe('settings_locked');   // cannot change once an evaluation was started
  });

  it('after submitting it is READ-ONLY: no save, no second submit, the grade and the time are kept, the event is recorded', async () => {
    await put('rita', { scores: { [C.team]: { score: 5 }, [C.market]: { score: 4, comment: 'Strong.' }, [C.tech]: { score: 10 } } });
    const ok = await submit('rita');
    expect(ok).toMatchObject({ status: 200, body: { ok: true, gradePercent: 92.5 } });           // Team 100 %, Market 4 on 1–5 = 75 %, Tech 100 %  →  50 + 22.5 + 20
    expect(evalRow('rita')).toMatchObject({ status: 'submitted', grade_percent: 92.5 });
    expect(events('eval_submitted')).toHaveLength(1);
    expect((await put('rita', { scores: { [C.team]: { score: 1 } } }))).toMatchObject({ status: 409, body: { code: 'submitted' } });
    expect((await submit('rita'))).toMatchObject({ status: 409, body: { code: 'submitted' } });
    expect(db.tables.call_eval_scores.find((s) => s.criterion_id === C.team)!.score).toBe(5);
    expect((await get('rita')).body).toMatchObject({ canEdit: false, evaluation: { status: 'submitted', gradePercent: 92.5 } });
  });

  it('the eliminatory minimum only FLAGS: below it the payload says so, and the evaluation can still be submitted', async () => {
    await put('rita', { scores: { [C.team]: { score: 1, comment: 'no' }, [C.market]: { score: 3, comment: 'ok' }, [C.tech]: { score: 5 } } });
    expect((await get('rita')).body.below).toEqual([{ id: C.team, name: 'Team', score: 1, min: 2 }]);
    expect((await submit('rita')).status).toBe(200);
  });

  it('a grid version change after the evaluation started does not change it: it keeps scoring on its own version', async () => {
    await put('rita', { scores: { [C.team]: { score: 4 } } });
    db.tables.call_evaluations.push({ id: 'ev-x', call_id: CALL, application_id: APP, evaluator_user_id: 'sara', grid_version: 1, status: 'submitted', revision: 3 });   // the first submitted evaluation freezes the grid
    as('ana');
    const v = await gridGet(json('GET'), { params: { id: CALL } }).then(read);
    const next = await gridPut(json('PUT', { baseRev: v.body.rev, confirm: true, criteria: [{ name: 'Only one', weight: 100, scaleMin: 1, scaleMax: 3 }], settings: v.body.settings }), { params: { id: CALL } }).then(read);
    expect(next.body.version).toBe(2);
    const r = await get('rita');
    expect(r.body.grid.version).toBe(1);
    expect(r.body.grid.criteria.map((c: { name: string }) => c.name)).toEqual(['Team', 'Market', 'Tech']);
  });

  it('a closed evaluation accepts no save and no submit; the screen says it is closed', async () => {
    await put('rita', { scores: { [C.team]: { score: 4 } } });
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { evaluation_closed_at: '2026-10-25T00:00:00Z' });
    expect((await put('rita', { scores: { [C.team]: { score: 5 } } }))).toMatchObject({ status: 409, body: { code: 'closed' } });
    expect((await submit('rita'))).toMatchObject({ status: 409, body: { code: 'closed' } });
    expect((await get('rita')).body).toMatchObject({ canEdit: false, call: { closed: true } });
  });
});

describe('reopening, colleagues and the private note', () => {
  async function submitted(u: string, scores: number[] = [5, 4, 10]) {
    await put(u, { scores: { [C.team]: { score: scores[0], comment: `team by ${u}` }, [C.market]: { score: scores[1], comment: `market by ${u}` }, [C.tech]: { score: scores[2] } }, overallComment: `overall ${u}`, privateNote: `secret of ${u}` });
    expect((await submit(u)).status).toBe(200);
  }

  it('only an administrator reopens, only a SUBMITTED evaluation, always with a reason; what was there is kept with it; the evaluator is told and can change it again', async () => {
    await submitted('rita');
    as('rita');
    expect((await reopenPost(json('POST', { evaluatorUserId: 'rita', reason: 'my own mistake' }), P(CALL, APP)).then(read)).status).toBe(403);
    as('ana');
    expect((await reopenPost(json('POST', { evaluatorUserId: 'rita', reason: 'x' }), P(CALL, APP)).then(read)).status).toBe(400);
    expect((await reopenPost(json('POST', { reason: 'long enough reason' }), P(CALL, APP)).then(read)).status).toBe(400);
    expect((await reopenPost(json('POST', { evaluatorUserId: 'sara', reason: 'long enough reason' }), P(CALL, APP)).then(read)).status).toBe(404);   // sara has nothing submitted
    const r = await reopenPost(json('POST', { evaluatorUserId: 'rita', reason: 'The market score was a typo.' }), P(CALL, APP)).then(read);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(evalRow('rita')).toMatchObject({ status: 'in_progress', reopened_count: 1, submitted_at: null });
    expect(db.tables.call_eval_reopenings[0]).toMatchObject({ reopened_by: 'ana', reason: 'The market score was a typo.' });
    expect((db.tables.call_eval_reopenings[0].snapshot as { scores: Record<string, { score: number }> }).scores[C.market].score).toBe(4);
    expect(events('eval_reopened')).toHaveLength(1);
    expect(db.tables.call_notices.filter((n) => n.user_id === 'rita' && String(n.title).startsWith('Evaluation reopened'))).toHaveLength(1);
    expect((await reopenPost(json('POST', { evaluatorUserId: 'rita', reason: 'again please' }), P(CALL, APP)).then(read)).status).toBe(409);        // no longer submitted
    expect((await put('rita', { scores: { [C.market]: { score: 5 } } })).status).toBe(200);
    expect((await submit('rita')).status).toBe(200);
  });

  it('colleagues\' evaluations: with the permission AND after submitting one\'s own — never before, never without it; never the private note; an administrator reads all, notes included', async () => {
    await submitted('rita');
    // sara has the permission but has not submitted: nothing
    expect((await get('sara')).body.colleagues).toBeNull();
    await put('sara', { scores: { [C.team]: { score: 2, comment: 'meh' } } });
    expect((await get('sara')).body.colleagues).toBeNull();
    // rita has submitted but lacks the permission: nothing
    expect((await get('rita')).body.colleagues).toBeNull();
    await put('sara', { scores: { [C.market]: { score: 3, comment: 'ok' }, [C.tech]: { score: 4 } } });
    expect((await submit('sara')).status).toBe(200);
    const sara = (await get('sara')).body.colleagues;
    expect(sara).toHaveLength(1);
    expect(sara[0]).toMatchObject({ userId: 'rita', gradePercent: 92.5, overallComment: 'overall rita' });
    expect(sara[0].scores[C.team]).toEqual({ score: 5, comment: 'team by rita' });
    expect(JSON.stringify(sara)).not.toContain('secret of rita');
    const admin = (await get('ana')).body;
    expect(admin.colleagues).toHaveLength(2);
    expect(JSON.stringify(admin.colleagues)).toContain('secret of rita');
    expect(admin.canReopen).toBe(true);
    expect((await get('sara')).body.canReopen).toBe(false);
    // an evaluator never sees what colleagues have STARTED
    await put('bruno', { scores: { [C.team]: { score: 1 } } }).catch(() => null);
    expect(JSON.stringify((await get('sara')).body.colleagues)).not.toContain('bruno');
  });
});

describe('"My evaluations"', () => {
  it('lists only what is theirs, by call, with where each stands, how many remain and the next deadline; an empty list says nothing is assigned', async () => {
    firmMember('tom'); onTeam(CALL, 'tom', category('Plain', { evaluate_assigned: true }));
    expect((await mine('tom')).body).toMatchObject({ ok: true, calls: [], remaining: 0 });
    expect((await mine(null)).status).toBe(401);
    const app2 = application(CALL, '3'); assign(CALL, app2.id, 'rita');
    await put('rita', { scores: { [C.team]: { score: 4 } } });
    const phaseId = db.tables.call_phases.find((p) => p.call_id === CALL)!.id as string;
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    as('ana'); const v = await gridGet(json('GET'), { params: { id: CALL } }).then(read);
    await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: { ...v.body.settings, deadlines: [{ phaseId, day }] } }), { params: { id: CALL } });
    const r = (await mine('rita')).body;
    expect(r.remaining).toBe(2);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ callId: CALL, callName: 'Evaluated Call', total: 2, notStarted: 1, inProgress: 1, submitted: 0, remaining: 2, deadline: { day, daysLeft: 3 } });
    expect(r.calls[0].items.map((i: { reference: string; state: string }) => `${i.reference}:${i.state}`)).toEqual(['REF-1:in_progress', 'REF-3:not_started']);
    expect(r.calls[0].items[0].startupName).toBe(STARTUP);
  });

  it('a call where they lost the permission, a deleted or archived call, and another call\'s applications are not listed; a submitted one stays with its grade', async () => {
    assign(CALL_B, APP_B, 'rita');                                                                     // assigned in another call where she is not on the team: not listed
    await put('rita', { scores: { [C.team]: { score: 5, comment: 'a' }, [C.market]: { score: 5, comment: 'b' }, [C.tech]: { score: 10 } } });
    await submit('rita');
    const r = (await mine('rita')).body;
    expect(r.calls.map((c: { callId: string }) => c.callId)).toEqual([CALL]);
    expect(r.calls[0].items[0]).toMatchObject({ state: 'submitted', gradePercent: 100 });
    expect(r.calls[0]).toMatchObject({ submitted: 1, remaining: 0 });
    db.tables.call_team_members.find((m) => m.user_id === 'rita' && m.call_id === CALL)!.permission_overrides = { evaluate_assigned: false };
    expect((await mine('rita')).body.calls).toEqual([]);
    db.tables.call_team_members.find((m) => m.user_id === 'rita' && m.call_id === CALL)!.permission_overrides = {};
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { status: 'archived' });
    expect((await mine('rita')).body.calls).toEqual([]);
  });

  it('before the migration "My evaluations" is simply empty and every other evaluation route says it is not available yet', async () => {
    delete (db.tables as Record<string, unknown>).call_eval_settings;
    expect((await mine('rita')).body).toMatchObject({ ok: true, calls: [] });
    expect((await get('rita')).status).toBe(503);
    expect((await put('rita', {})).status).toBe(503);
    expect((await submit('rita')).status).toBe(503);
  });
});

describe('each call is isolated', () => {
  it('an evaluation of one call never appears in another; the same application id cannot be opened through another call', async () => {
    const b = application(CALL_B, '4');
    expect((await get('rita', CALL_B, b.id)).status).toBe(403);                                       // same organisation, but she is not on call B's team: not assigned
    expect((await get('ana', CALL_B, APP)).status).toBe(404);                                         // APP belongs to CALL
    expect((await get('ana', CALL, b.id)).status).toBe(404);
    await put('rita', { scores: { [C.team]: { score: 3 } } });
    expect(db.tables.call_evaluations.filter((e) => e.call_id === CALL_B)).toHaveLength(0);
  });
});

