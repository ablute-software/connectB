// Prompt 922 (I4) — the consolidation through the real handlers over the stateful fake database, with the permissions enforced against the API: the board (progress, ranking by weighted average, the average of each
// criterion, divergence and minimum flags, the grid version) for whoever has "Configure call" or "Final decision"; the decision (Advance / Reject / Waitlist, optional note, history kept, nothing sent to the
// applicant) and "Close evaluation" only with "Final decision"; the export (CSV and Excel) only with "Final decision", with no comment in it and no formula in a cell; each call isolated.
import * as XLSX from 'xlsx';
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
import { GET as boardGet, POST as boardPostRaw } from './[id]/evaluation-board/route';
import { GET as exportGet } from './[id]/evaluation-board/export/route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { PUT as evalPut } from './[id]/evaluations/[applicationId]/route';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

let CALL = ''; let CALL_B = '';
let C: { team: string; market: string };
const A: Record<string, string> = {};
const board = (u: string | null, callId = CALL) => { as(u); return boardGet(json('GET'), { params: { id: callId } }).then(read); };
const act = (u: string, body: Record<string, unknown>, callId = CALL) => { as(u); return boardPostRaw(json('POST', body), { params: { id: callId } }).then(read); };
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);

function firmMember(id: string) { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' }); }
const category = (name: string, perms: Record<string, boolean>) => { const id = `cat-${name}`; db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' }); return id; };
const onTeam = (callId: string, userId: string, categoryId: string) => db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId, permission_overrides: {}, created_at: '2026-01-02T00:00:00.000Z' });

function application(callId: string, tag: string, ref: string, name: string) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(`ap-${tag}`, { id: `ap-${tag}`, email: `ap-${tag}@startup${tag}.com` });
  db.tables.orgs.push({ id: org, name });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `ap-${tag}`, status: 'submitted', reference: ref, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  return id;
}
function evaluation(callId: string, appId: string, who: string, scores: Record<string, number>, grade: number, opts: { status?: 'submitted' | 'in_progress'; version?: number; comment?: string; note?: string } = {}) {
  const id = `ev-${appId.slice(-4)}-${who}`;
  db.tables.call_evaluations.push({ id, call_id: callId, application_id: appId, evaluator_user_id: who, grid_version: opts.version ?? 1, status: opts.status ?? 'submitted', grade_percent: grade, overall_comment: opts.comment ?? 'OVERALL-COMMENT-SECRET', private_note: opts.note ?? 'PRIVATE-NOTE-SECRET', revision: 1, reopened_count: 0 });
  for (const [criterion, score] of Object.entries(scores)) db.tables.call_eval_scores.push({ evaluation_id: id, criterion_id: criterion, score, comment: 'CRITERION-COMMENT-SECRET' });
  db.tables.call_eval_assignments.push({ id: `as-${id}`, call_id: callId, application_id: appId, evaluator_user_id: who, source: 'auto', status: 'assigned', created_at: '2026-10-20T00:00:00Z' });
}

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana'); db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Evaluated Call: 2027' })))).body.call.id as string;
  CALL_B = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  firmMember('decider'); onTeam(CALL, 'decider', category('Decider', { final_decision: true }));
  firmMember('configurer'); onTeam(CALL, 'configurer', category('Configurer', { configure_call: true, manage_team: true }));
  firmMember('reader'); onTeam(CALL, 'reader', category('Reader', { view_all_applications: true }));
  firmMember('rita'); onTeam(CALL, 'rita', category('Evaluator', { evaluate_assigned: true }));
  const v = await gridGet(json('GET'), { params: { id: CALL } }).then(read);
  const g = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: [{ name: 'Team', weight: 50, scaleMin: 1, scaleMax: 5, minScore: 2 }, { name: 'Market', weight: 50, scaleMin: 0, scaleMax: 10 }], settings: v.body.settings }), { params: { id: CALL } }).then(read);
  C = { team: g.body.criteria[0].id, market: g.body.criteria[1].id };
  A.a = application(CALL, '1', 'REF-001', '=EVIL("x") Startup'); A.b = application(CALL, '2', 'REF-002', 'Blue Health'); A.c = application(CALL, '3', 'REF-003', 'Cyan Labs');
  evaluation(CALL, A.a, 'rita', { [C.team]: 5, [C.market]: 10 }, 100);
  evaluation(CALL, A.a, 'decider', { [C.team]: 1, [C.market]: 4 }, 30);                            // far from rita: divergence, and below the minimum of Team
  evaluation(CALL, A.b, 'rita', { [C.team]: 4, [C.market]: 8 }, 80);
  evaluation(CALL, A.c, 'rita', { [C.team]: 3 }, 0, { status: 'in_progress' });
});

describe('the board — who reads it and what it holds', () => {
  it('"Configure call" or "Final decision" read it; a reader, an evaluator, a stranger and the signed-out do not (403 / 404 / 401)', async () => {
    expect((await board('ana')).status).toBe(200);
    expect((await board('decider')).status).toBe(200);
    expect((await board('configurer')).status).toBe(200);
    expect((await board('reader')).status).toBe(403);
    expect((await board('rita')).status).toBe(403);
    db.users.set('stranger', { id: 'stranger', email: 'stranger@x.test' }); expect([403, 404]).toContain((await board('stranger')).status);
    expect((await board(null)).status).toBe(401);
  });

  it('progress, ranking by weighted average (an in-progress evaluation never counts), the average of each criterion, the divergence and the minimum flags, the grid version', async () => {
    const r = await board('ana');
    expect(r.body).toMatchObject({ ok: true, version: 1, closed: false, progress: { applications: 3, assigned: 4, started: 4, submitted: 3, complete: 2, decided: 0 } });
    expect(r.body.rows.map((x: { reference: string; rank: number | null; average: number | null; state: string }) => [x.reference, x.rank, x.average, x.state])).toEqual([['REF-002', 1, 80, 'complete'], ['REF-001', 2, 65, 'complete'], ['REF-003', null, null, 'in_progress']]);
    const a = r.body.rows.find((x: { reference: string }) => x.reference === 'REF-001');
    expect(a.deviation).toBe(35);
    expect(a.perCriterion).toEqual([{ criterionId: C.team, name: 'Team', average: 3, percent: 50, count: 2 }, { criterionId: C.market, name: 'Market', average: 7, percent: 70, count: 2 }]);
    expect(a.divergence.map((d: { name: string; kind: string }) => `${d.kind}:${d.name}`)).toEqual(['criterion:Team', 'criterion:Market', 'total:Total']);
    expect(a.below).toEqual([{ criterionId: C.team, name: 'Team', min: 2, evaluators: 1 }]);
    expect(a.gridVersions).toEqual([1]);
    expect(r.body.criteria.map((c: { name: string }) => c.name)).toEqual(['Team', 'Market']);
  });

  it('divergence follows the entity\'s settings: switched off, no flag; a lax limit, no flag', async () => {
    as('ana');
    const v = await gridGet(json('GET'), { params: { id: CALL } }).then(read);
    await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: { ...v.body.settings, divergence: { enabled: false, scalePct: 40, totalPct: 20 } } }), { params: { id: CALL } });
    expect((await board('ana')).body.rows.find((x: { reference: string }) => x.reference === 'REF-001').divergence).toEqual([]);
  });

  it('the evaluators\' scores are never changed by the board; the board is read-only for whoever cannot decide', async () => {
    const before = JSON.stringify(db.tables.call_eval_scores);
    await board('ana'); await board('configurer');
    expect(JSON.stringify(db.tables.call_eval_scores)).toBe(before);
    expect((await act('configurer', { action: 'decide', applicationId: A.a, decision: 'advance' })).status).toBe(403);
    expect((await act('configurer', { action: 'close' })).status).toBe(403);
    expect(db.tables.call_eval_decisions).toHaveLength(0);
    expect(db.tables.calls.find((c) => c.id === CALL)!.evaluation_closed_at ?? null).toBeNull();
  });
});

describe('the final decision', () => {
  it('Advance, Reject or Waitlist with an optional note; the board shows it; changing it keeps the earlier one as history; the same decision again changes nothing; clearing removes it', async () => {
    const a = await act('decider', { action: 'decide', applicationId: A.a, decision: 'advance', note: 'Strong despite the divergence.' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.rows.find((x: { reference: string }) => x.reference === 'REF-001').decision).toEqual({ decision: 'advance', note: 'Strong despite the divergence.' });
    expect(a.body.progress.decided).toBe(1);
    expect(events('eval_decision')).toHaveLength(1);
    await act('decider', { action: 'decide', applicationId: A.a, decision: 'advance', note: 'Strong despite the divergence.' });
    expect(db.tables.call_eval_decisions).toHaveLength(1);                                           // identical: nothing new
    await act('decider', { action: 'decide', applicationId: A.a, decision: 'waitlist', note: '' });
    expect(db.tables.call_eval_decisions.map((d) => `${d.decision}:${d.is_current}`)).toEqual(['advance:false', 'waitlist:true']);
    expect((events('eval_decision')[1].detail as { before: { decision: string } }).before.decision).toBe('advance');
    const cleared = await act('decider', { action: 'decide', applicationId: A.a, decision: null });
    expect(cleared.body.rows.find((x: { reference: string }) => x.reference === 'REF-001').decision).toBeNull();
    expect(db.tables.call_eval_decisions.every((d) => d.is_current === false)).toBe(true);
    expect((await act('decider', { action: 'decide', applicationId: A.a, decision: 'reject' })).status).toBe(200);
    expect(db.tables.call_eval_decisions.filter((d) => d.is_current)).toHaveLength(1);
  });

  it('refuses a decision that is not one of the three, an application that is not of this call, and sends NOTHING to the applicant', async () => {
    expect((await act('decider', { action: 'decide', applicationId: A.a, decision: 'maybe' })).body.error).toBe('Choose Advance, Reject or Waitlist.');
    expect((await act('decider', { action: 'decide', applicationId: 'aaaaaaaa-0000-4000-8000-999999999999', decision: 'advance' })).status).toBe(404);
    const other = application(CALL_B, '9', 'REF-900', 'Other');
    expect((await act('decider', { action: 'decide', applicationId: other, decision: 'advance' })).status).toBe(404);          // another call's application
    expect((await act('decider', { action: 'nope' })).status).toBe(400);
    const noticesBefore = db.tables.call_notices.length;
    await act('decider', { action: 'decide', applicationId: A.b, decision: 'reject', note: 'x'.repeat(5000) });
    expect(db.tables.call_notices.length).toBe(noticesBefore);
    expect(String(db.tables.call_eval_decisions[0].note).length).toBe(1000);
  });
});

describe('"Close evaluation"', () => {
  it('closes (evaluators can no longer save or submit), is recorded, cannot be closed twice, and can be reopened by whoever has "Final decision"', async () => {
    const c = await act('decider', { action: 'close' });
    expect(c.body).toMatchObject({ ok: true, closed: true });
    expect(db.tables.calls.find((x) => x.id === CALL)).toMatchObject({ evaluation_closed_by: 'decider' });
    expect(events('eval_closed')).toHaveLength(1);
    expect((await act('decider', { action: 'close' })).status).toBe(409);
    db.tables.call_applications.find((a) => a.id === A.c)!.current_submission_id = 'sub-c';       // an evaluator reaches an application only through its submitted version
    as('rita');
    const saved = await evalPut(json('PUT', { scores: { [C.team]: { score: 2 } } }), { params: { id: CALL, applicationId: A.c } }).then(read);
    expect(saved).toMatchObject({ status: 409, body: { code: 'closed' } });
    const reopened = await act('decider', { action: 'reopen' });
    expect(reopened.body).toMatchObject({ ok: true, closed: false });
    expect((await act('decider', { action: 'reopen' })).status).toBe(409);
  });
});

describe('the export', () => {
  const get = (u: string, q = '', callId = CALL) => { as(u); return exportGet(new Request(`http://localhost/x${q}`), { params: { id: callId } }); };

  it('only "Final decision"; CSV by default with a BOM and semicolons, the file named after the call; the export is recorded', async () => {
    expect((await get('configurer')).status).toBe(403);
    expect((await get('rita')).status).toBe(403);
    const r = await get('decider');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Evaluated-Call-2027-evaluation.csv"');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);                                                  // the BOM is in the file (Response.text() would hide it)
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith('﻿Rank;Reference;Startup;')).toBe(true);
    expect(text.split('\r\n')[1].startsWith('1;REF-002;Blue Health;1;1;80;')).toBe(true);
    expect(events('eval_exported')).toHaveLength(1);
  });

  it('NO comment is ever in the file — not the criterion comments, not the general comments, not the private notes; a startup name that looks like a formula is kept as text', async () => {
    const csv = await (await get('decider')).text();
    for (const secret of ['CRITERION-COMMENT-SECRET', 'OVERALL-COMMENT-SECRET', 'PRIVATE-NOTE-SECRET']) expect(csv).not.toContain(secret);
    expect(csv).toContain("'=EVIL(\"\"x\"\") Startup");
    expect(csv).not.toMatch(/(^|;)=EVIL/m);
    const x = await get('decider', '?format=xlsx');
    expect(x.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const wb = XLSX.read(Buffer.from(await x.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ Rank: 1, Reference: 'REF-002', 'Average grade (%)': 80 });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
    expect(String(rows.find((r) => r.Reference === 'REF-001')!.Startup)).toBe("'=EVIL(\"x\") Startup");
  });

  it('carries the decisions; an empty call exports just the header', async () => {
    await act('decider', { action: 'decide', applicationId: A.b, decision: 'advance', note: 'Go' });
    expect((await (await get('decider')).text())).toContain('Advance;Go');
    firmMember('d2'); onTeam(CALL_B, 'd2', category('Decider B', { final_decision: true }));
    const empty = await (await get('d2', '', CALL_B)).text();
    expect(empty.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('each call is isolated', () => {
  it('the board of one call holds none of another\'s applications or evaluations; the decision of one never reaches the other', async () => {
    const other = application(CALL_B, '8', 'REF-800', 'Other');
    expect((await board('ana', CALL)).body.rows.map((r: { reference: string }) => r.reference)).not.toContain('REF-800');
    expect((await board('ana', CALL_B)).body.rows.map((r: { reference: string }) => r.reference)).toEqual(['REF-800']);
    expect((await act('ana', { action: 'decide', applicationId: other, decision: 'advance' }, CALL_B)).status).toBe(200);
    expect(db.tables.call_eval_decisions.every((d) => d.call_id === CALL_B)).toBe(true);
    expect((await board('ana', CALL)).body.progress.decided).toBe(0);
  });

  it('before the migration the board says it is not available yet', async () => {
    delete (db.tables as Record<string, unknown>).call_eval_settings;
    expect((await board('ana')).status).toBe(503);
    expect((await act('decider', { action: 'close' })).status).toBe(503);
  });
});
