// Prompt 918 (I3) — Applications through the real handlers: the list with its sub-views (Fit / Not a fit / To validate / Processing) and counts, the detail with the eligibility rule by rule and the
// possible duplicates, what a person may do (the permission is enforced by the SERVER: correcting needs "Correct eligibility & document validity", flagging only "View all applications"), the queue run
// by the Applications tab, and the first go at the evaluation right after a submission. Drafts never appear.
import { PDFDocument, StandardFonts } from 'pdf-lib';
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

import { GET as listGet } from './[id]/submissions/route';
import { GET as detailGet } from './[id]/submissions/[applicationId]/route';
import { POST as eligPost } from './[id]/submissions/[applicationId]/eligibility/route';
import { POST as processPost } from './[id]/submissions/process/route';
import { processApplicationNow } from '@/lib/calls/eligibility-engine';
import { writeRules } from '@/lib/calls/eligibility-store';
import { newField } from '@/lib/calls/form-builder';
import { rowToCall } from '@/lib/calls/mappers';
import type { EligibilityRule } from '@/lib/calls/eligibility';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const DAY = 86_400_000;
const Q = { raised: '10000000-0000-4000-8000-000000000002', cert: '10000000-0000-4000-8000-000000000003', name: '10000000-0000-4000-8000-000000000004', open: '10000000-0000-4000-8000-000000000006' };
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const admin = () => fakeCallsAdmin(db, storage);

async function pdf(text: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]);
  if (text) { const font = await doc.embedFont(StandardFonts.Helvetica); text.split('\n').forEach((l, i) => page.drawText(l, { x: 40, y: 780 - i * 18, size: 12, font })); }
  return new Uint8Array(await doc.save());
}
const CERT = 'CERTIDAO PERMANENTE\nConservatoria do Registo Comercial de Lisboa\nCodigo de acesso: 1234-5678-9012\nMatricula e NIPC: 513456789\nFirma: Acme Robotics, Lda.\nCertidao emitida em 12/09/2026.';

let n = 0;
async function submitted(startup: string, over: { raised?: string; file?: Uint8Array | null; org?: Record<string, unknown>; members?: string[] } = {}) {
  n++;
  const orgId = `4000000${n}-0000-4000-8000-000000000001`;
  db.tables.orgs.push({ id: orgId, name: startup, is_test: false, website: null, ...(over.org ?? {}) });
  for (const u of over.members ?? [`founder-${n}`]) { db.users.set(u, { id: u, email: `${u}@${startup.toLowerCase().replace(/\W/g, '')}.pt` }); db.tables.org_members.push({ org_id: orgId, user_id: u, role: 'owner' }); }
  const appId = `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`; const subId = `00000000-0000-4000-8000-${String(1900 + n).padStart(12, '0')}`;
  db.tables.call_applications.push({ id: appId, call_id: CALL, status: 'submitted', startup_org_id: orgId, applicant_user_id: `founder-${n}`, draft_answers: {}, current_submission_id: subId, reference: `REF-${n}`, unit_key: `o:${n}`, submitted_at: new Date(Date.now() - n * 1000).toISOString(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
  const path = `calls/${CALL}/applications/${appId}/frozen/f${n}.pdf`;
  const file = over.file === undefined ? await pdf(CERT) : over.file;
  if (file) storage.objects.set(path, { bytes: file });
  db.tables.call_application_submissions.push({ id: subId, application_id: appId, version: 1, answers: { [Q.raised]: over.raised ?? '300000', [Q.name]: startup }, documents: file ? [{ fieldId: Q.cert, fileId: `f${n}`, fileName: 'certidao.pdf', frozenPath: path }] : [], form_snapshot: {}, submitted_by: 'u', submitted_at: new Date().toISOString(), idempotency_key: `k${n}` });
  db.tables.call_processing_tasks.push({ id: `00000000-0000-4000-8000-${String(2900 + n).padStart(12, '0')}`, call_id: CALL, application_id: appId, submission_id: subId, kind: 'eligibility', rules_version: 1, status: 'queued', attempts: 0, max_attempts: 5, run_after: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() + n).toISOString(), locked_at: null, last_error: null });
  return { appId, orgId };
}

const detail = async (appId: string) => read(await detailGet(json('GET'), { params: { id: CALL, applicationId: appId } }));
const list = async () => read(await listGet(json('GET'), { params: { id: CALL } }));
const act = (appId: string, body: Record<string, unknown>) => eligPost(json('POST', body), { params: { id: CALL, applicationId: appId } }).then(read);

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; n = 0; currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.calls.push({ id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'Call', description: 'x', status: 'open', opens_at: new Date(Date.now() - 20 * DAY).toISOString(), closes_at: new Date(Date.now() + 20 * DAY).toISOString(), timezone: 'Europe/Lisbon', visibility: 'unlisted', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', link_token: 'tok-i3-0123456789abcdef', config_version: 3, eligibility_version: 1, eligibility_rev: 0, created_by: 'ana', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
  const f = [
    { ...newField('number', 1, 0), id: Q.raised, label: 'Amount you are raising' },
    { ...newField('file', 2, 0), id: Q.cert, label: 'Permanent Certificate', instruction: 'Issued less than 3 months ago.' },
    { ...newField('short_text', 1, 1), id: Q.name, label: 'Company name' },
    { ...newField('long_text', 1, 2), id: Q.open, label: 'Social impact' },
  ];
  db.tables.call_form_fields.push(...f.map((x) => ({ call_id: CALL, id: x.id, page: x.page, position: x.position, kind: x.kind, label: x.label, instruction: x.instruction, required: false, options: [], validations: {}, condition: null, platform_mapping: null, expected_type: null, max_age_months: null })));
  const rules: EligibilityRule[] = [
    { id: '30000000-0000-4000-8000-00000000000a', fieldId: Q.raised, kind: 'number', params: { op: 'lte', value: 500000 }, note: null, position: 0 },
    { id: '30000000-0000-4000-8000-00000000000b', fieldId: Q.cert, kind: 'doc_valid', params: { maxAgeMonths: null, matchName: Q.name, matchTaxId: null }, note: null, position: 1 },
  ];
  await writeRules(admin(), rowToCall(db.tables.calls[0]), 1, rules, f, 'ana');
  as('ana');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the list: sub-views, counts, and never a draft', () => {
  it('Fit / Not a fit / To validate, and what is still being checked in Processing; a draft is never listed', async () => {
    const ok = await submitted('Acme Robotics', { members: ['f-acme'] });
    const over = await submitted('Big Spender', { raised: '900000' });
    const scanned = await submitted('Scan Co', { file: await pdf(null) });
    const waiting = await submitted('Slow Co');
    db.tables.call_applications.push({ id: 'draft-1', call_id: CALL, status: 'draft', startup_org_id: null, applicant_user_id: 'x', draft_answers: { secret: 1 }, reference: 'DRAFT', unit_key: 'd', created_at: new Date().toISOString() });
    // everything but "Slow Co" is evaluated
    db.tables.call_processing_tasks.find((t) => t.application_id === waiting.appId)!.run_after = new Date(Date.now() + 3_600_000).toISOString();
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ fit: 1, not_fit: 1, to_validate: 1, processing: 1 });
    const by = (id: string) => r.body.submissions.find((s: { applicationId: string }) => s.applicationId === id).eligibility;
    expect(by(ok.appId)).toMatchObject({ state: 'fit', view: 'fit' });
    expect(by(over.appId)).toMatchObject({ state: 'not_fit', view: 'not_fit' });
    expect(by(scanned.appId)).toMatchObject({ state: 'to_validate', view: 'to_validate' });
    expect(by(waiting.appId)).toMatchObject({ state: 'queued', view: 'processing' });
    expect(r.body.submissions).toHaveLength(4);
    expect(JSON.stringify(r.body)).not.toContain('DRAFT');
    expect(r.body.canCorrect).toBe(true);
  });

  it('a technical failure is in Processing and says it was not counted against the applicant', async () => {
    const bad = await submitted('Broken Co', { file: null });
    db.tables.call_application_submissions.find((s) => s.application_id === bad.appId)!.documents = [{ fieldId: Q.cert, fileId: 'gone', fileName: 'gone.pdf', frozenPath: 'calls/x/missing.pdf' }];
    Object.assign(db.tables.call_processing_tasks[0], { attempts: 4 });
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    const r = await list();
    expect(r.body.submissions[0].eligibility).toMatchObject({ state: 'technical_failure', view: 'processing' });
    expect(r.body.submissions[0].eligibility.reason).toContain('not counted against the applicant');
  });
});

describe('the detail: the rule-by-rule result, the evidence and the possible duplicates', () => {
  it('shows each rule with what was found (the file, the page, the quote) and the sentence of the rule', async () => {
    const { appId } = await submitted('Acme Robotics');
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    const d = await detail(appId);
    expect(d.body.eligibility).toMatchObject({ state: 'fit', rulesVersion: 1 });
    const doc = d.body.eligibility.rules.find((r: { kind: string }) => r.kind === 'doc_valid');
    expect(doc).toMatchObject({ engine: 'pass', effective: 'pass', evidence: { fileName: 'certidao.pdf', page: 1 } });
    expect(doc.sentence).toContain('Permanent Certificate');
    expect(d.body.canCorrect).toBe(true);
  });

  it('"Possible duplicate": the other applications of THIS call that share something; nothing is blocked', async () => {
    const a = await submitted('Acme Robotics, Lda', { members: ['ana-acme'], org: { website: 'https://www.acme.pt' } });
    const b = await submitted('ACME ROBOTICS', { members: ['bruno-acme'], org: { website: 'http://acme.pt/en' } });
    const c = await submitted('Unrelated Co');
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    const d = await detail(a.appId);
    expect(d.body.duplicates).toHaveLength(1);
    expect(d.body.duplicates[0]).toMatchObject({ applicationId: b.appId });
    expect(d.body.duplicates[0].signals).toEqual(expect.arrayContaining(['same_name', 'same_website']));
    expect((await detail(c.appId)).body.duplicates).toEqual([]);
    const l = await list();
    expect(l.body.submissions.find((s: { applicationId: string }) => s.applicationId === a.appId).duplicates).toBe(1);
  });
});

describe('what a person may do — enforced by the server', () => {
  async function restrictedMember(corrects: boolean) {
    db.users.set('rita', { id: 'rita', email: 'rita@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-rita', user_id: 'rita', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    db.tables.call_team_categories.push({ id: 'cat-r', catalog_entity_id: FIRM, incubator_id: null, name: 'Reader', permissions: { view_all_applications: true, correct_eligibility: corrects } });
    db.tables.call_team_members.push({ id: 'tm-r', call_id: CALL, user_id: 'rita', category_id: 'cat-r', permission_overrides: {} });
  }

  it('correcting a rule (with a reason) changes the result and is kept; without the permission it is refused (403) although the person can read the application', async () => {
    const { appId } = await submitted('Acme Robotics', { raised: '900000' });
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    const rule = (await detail(appId)).body.eligibility.rules.find((r: { kind: string }) => r.kind === 'number');
    await restrictedMember(false);
    as('rita');
    expect((await detail(appId)).status).toBe(200);
    expect((await act(appId, { action: 'correct_rule', ruleId: rule.ruleId, outcome: 'pass', justification: 'ok' })).status).toBe(403);
    expect((await act(appId, { action: 'reclassify', status: 'fit', justification: 'ok' })).status).toBe(403);
    expect((await act(appId, { action: 'retry' })).status).toBe(403);
    expect(db.tables.call_eligibility_corrections).toHaveLength(0);
    as('ana');
    expect((await act(appId, { action: 'correct_rule', ruleId: rule.ruleId, outcome: 'pass', justification: '   ' })).status).toBe(400);
    const done = await act(appId, { action: 'correct_rule', ruleId: rule.ruleId, outcome: 'pass', justification: 'The amount is in another currency', callException: true });
    expect(done).toMatchObject({ status: 200, body: { ok: true, status: 'fit' } });
    const after = await detail(appId);
    expect(after.body.eligibility).toMatchObject({ state: 'fit', source: 'human' });
    expect(after.body.eligibility.rules.find((r: { kind: string }) => r.kind === 'number')).toMatchObject({ engine: 'fail', effective: 'pass', override: { why: 'The amount is in another currency' } });
    expect(db.tables.call_eligibility_corrections).toMatchObject([{ call_id: CALL, rule_kind: 'number', engine_outcome: 'fail', human_outcome: 'pass', is_call_exception: true }]);
    expect(db.tables.call_events.some((e) => e.event === 'eligibility_corrected')).toBe(true);
  });

  it('flagging needs only "View all applications": it sends the application to To validate with the reason, and does not exclude it', async () => {
    const { appId } = await submitted('Acme Robotics');
    await read(await processPost(json('POST'), { params: { id: CALL } }));
    await restrictedMember(false);
    as('rita');
    const r = await act(appId, { action: 'flag', reason: 'Looks like a duplicate of another startup' });
    expect(r).toMatchObject({ status: 200, body: { ok: true, status: 'to_validate' } });
    expect((await detail(appId)).body.eligibility).toMatchObject({ state: 'to_validate', source: 'flag' });
    expect((await act(appId, { action: 'flag', reason: '' })).status).toBe(400);
    // a stranger and a signed-out caller can do nothing
    db.users.set('zed', { id: 'zed', email: 'zed@example.com' });
    as('zed');
    expect((await act(appId, { action: 'flag', reason: 'x' })).status).toBe(403);
    as(null);
    expect((await act(appId, { action: 'flag', reason: 'x' })).status).toBe(401);
  });

  it('retrying a technical failure queues it again; with nothing to retry it says so; an unknown action or a draft is refused', async () => {
    const { appId } = await submitted('Acme Robotics');
    expect((await act(appId, { action: 'retry' })).status).toBe(409);
    Object.assign(db.tables.call_processing_tasks[0], { status: 'technical_failure', attempts: 5, last_error: 'boom' });
    const r = await act(appId, { action: 'retry' });
    expect(r).toMatchObject({ status: 200, body: { ok: true, queued: 1 } });
    expect(db.tables.call_processing_tasks[0]).toMatchObject({ status: 'queued', attempts: 0, last_error: null });
    expect((await act(appId, { action: 'what' })).status).toBe(400);
    db.tables.call_applications.push({ id: 'draft-2', call_id: CALL, status: 'draft', applicant_user_id: 'x', draft_answers: {}, unit_key: 'd2', created_at: new Date().toISOString() });
    expect((await act('draft-2', { action: 'flag', reason: 'x' })).status).toBe(404);
  });

  it('the Applications tab can take the queue forward — only whoever may view the applications', async () => {
    await submitted('Acme Robotics');
    db.users.set('zed', { id: 'zed', email: 'zed@example.com' });
    as('zed');
    expect((await processPost(json('POST'), { params: { id: CALL } })).status).toBe(403);
    as('ana');
    expect(await read(await processPost(json('POST'), { params: { id: CALL } }))).toMatchObject({ status: 200, body: { ok: true, claimed: 1, done: 1 } });
  });
});

describe('the first go right after a submission', () => {
  it('gives the task of THAT application a bounded first run: the result is usually there when the entity looks; what fails stays queued', async () => {
    const { appId } = await submitted('Acme Robotics');
    await processApplicationNow(admin(), appId);
    expect(db.tables.call_application_eligibility.find((r) => r.application_id === appId)).toMatchObject({ status: 'fit', is_current: true });
    const bad = await submitted('Broken Co', { file: null });
    db.tables.call_application_submissions.find((s) => s.application_id === bad.appId)!.documents = [{ fieldId: Q.cert, fileId: 'gone', fileName: 'gone.pdf', frozenPath: 'calls/x/missing.pdf' }];
    await processApplicationNow(admin(), bad.appId);
    expect(db.tables.call_processing_tasks.find((t) => t.application_id === bad.appId)).toMatchObject({ status: 'queued', attempts: 1 });
    expect(db.tables.call_application_eligibility.find((r) => r.application_id === bad.appId)).toBeUndefined();
  });

  it('the submit route does it (and never lets it break a submission)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/app/api/calls/apply/applications/[id]/submit/route.ts`, 'utf8');
    expect(src).toContain('processApplicationNow');
    expect(src).toMatch(/processApplicationNow\(a\.admin, a\.app\.id\)\.catch/);
  });
});
