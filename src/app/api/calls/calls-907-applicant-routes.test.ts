// Prompt 907, I2 and I3 — filling in and submitting an application, through the real handlers and the real access rules over the stateful fake
// database (which models call_open_application and call_submit_application line by line: the per-unit limit, create-or-resume, the idempotency key,
// the immutable version, the server's clock).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at: string | null } | null;
const sent: { to: string; subject: string; html: string; text?: string; replyTo?: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  transactionalTemplate: (o: unknown) => JSON.stringify(o),
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text?: string; replyTo?: string }) => { sent.push(m); return { sent: true, id: 'em_1' }; },
}));
vi.mock('@/lib/upload-security', async (orig) => ({ ...(await orig<typeof import('@/lib/upload-security')>()), scanWithVirusTotal: async () => ({ status: 'clean', provider: null, detail: '' }) }));

import { POST as startPost } from './apply/[token]/start/route';
import { GET as appGet, PUT as appPut } from './apply/applications/[id]/route';
import { POST as filesPost } from './apply/applications/[id]/files/route';
import { DELETE as fileDelete } from './apply/applications/[id]/files/[fileId]/route';
import { POST as refreshPost } from './apply/applications/[id]/files/[fileId]/refresh/route';
import { GET as vaultGet } from './apply/applications/[id]/vault/route';
import { POST as submitPost } from './apply/applications/[id]/submit/route';
import { GET as publicGet } from './public/[token]/route';
import { GET as unsubscribeGet } from '../email/unsubscribe/route';
import { setCallLimit } from '@/lib/calls/call-limit';
import { preferenceToken } from '@/lib/email-preferences';
import { FULL_MESSAGE } from '@/lib/calls/applicant/full';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tok-907-apply-0123456789abcd';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 86_400_000;
const F = { name: 'f0000000-0000-4000-8000-000000000001', who: 'f0000000-0000-4000-8000-000000000002', stage: 'f0000000-0000-4000-8000-000000000003', inc: 'f0000000-0000-4000-8000-000000000004',
  when: 'f0000000-0000-4000-8000-000000000005', amount: 'f0000000-0000-4000-8000-000000000006', deck: 'f0000000-0000-4000-8000-000000000007', note: 'f0000000-0000-4000-8000-000000000008' };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a]); // "%PDF-1.7 …"

const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls/apply', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const idp = (id: string) => ({ params: { id } });
const as = (userId: string | null, confirmed = true) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: confirmed ? '2026-10-01T00:00:00Z' : null } : null; };
const start = (token = TOKEN, body: unknown = {}) => startPost(req('POST', body), { params: { token } }).then(read);
const call = () => db.tables.calls.find((c) => c.id === CALL)!;
const apps = () => db.tables.call_applications;
const put = (id: string, answers: Record<string, unknown>, baseRevision: number, lastPage = 1) => appPut(req('PUT', { answers, lastPage, baseRevision }), idp(id)).then(read);

function seed(over: Record<string, unknown> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; sent.length = 0; db.nowMs = undefined;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  db.tables.calls.push({
    id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'Seed Call 2027', description: 'Summary', status: 'open',
    opens_at: new Date(Date.now() - 2 * DAY).toISOString(), closes_at: new Date(Date.now() + 5 * DAY).toISOString(), timezone: 'Europe/Lisbon', visibility: 'unlisted',
    limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', link_token: TOKEN, config_version: 3, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', contact_email: null, ...over,
  });
  const f = (id: string, kind: string, label: string, page: number, position: number, extra: Record<string, unknown> = {}) =>
    db.tables.call_form_fields.push({ id, call_id: CALL, kind, label, page, position, required: false, options: [], validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null, ...extra });
  f(F.name, 'short_text', 'Startup name', 1, 0, { required: true, platform_mapping: 'company_name' });
  f(F.who, 'short_text', 'Your name', 1, 1, { platform_mapping: 'person_name' });
  f(F.stage, 'single_choice', 'Stage', 1, 2, { platform_mapping: 'stage', options: [{ id: 'st-pre', label: 'Pre-seed' }, { id: 'st-seed', label: 'Seed' }] });
  f(F.inc, 'yes_no', 'Incorporated?', 2, 0, { required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
  f(F.when, 'date', 'Incorporation date', 2, 1, { required: true, condition: { fieldId: F.inc, operator: 'equals', value: 'yes' } });
  f(F.amount, 'number', 'Amount you are raising', 2, 2);
  f(F.deck, 'file', 'Pitch deck', 3, 0, { required: true, validations: { maxFileMb: 1 } });
  f(F.note, 'long_text', 'Anything else?', 3, 1);
  db.tables.orgs.push({ id: ORG_A, name: 'Acme Robotics', legal_name: 'Acme Robotics, Lda', country: 'Portugal', sector: 'Industrial', stage: 'pre_seed', website: 'https://acme.example' });
  db.tables.orgs.push({ id: ORG_B, name: 'Other Co', legal_name: 'Other Co SA', country: 'Spain', sector: null, stage: 'seed', website: null });
  db.tables.org_members.push({ org_id: ORG_A, user_id: 'founder-a', role: 'owner', full_name: 'Ana Test', title: 'CEO' });
  db.tables.org_members.push({ org_id: ORG_B, user_id: 'founder-b', role: 'owner', full_name: 'Bruno Other', title: 'CTO' });
  db.users.set('founder-a', { id: 'founder-a', email: 'founder-a@example.com' }); db.users.set('founder-b', { id: 'founder-b', email: 'founder-b@example.com' });
  as('founder-a');
}
beforeEach(() => seed());

const draftOf = async () => { const s = await start(); expect(s.status).toBe(200); return s.body as { state: { application: { id: string; revision: number; reference: string }; answers: Record<string, unknown>; orgId: string }; page: number; created: boolean }; };
/** Upload a PDF for the deck question the way the browser does: the object is already in the startup's folder when the route is called. */
function putObject(orgId: string, name: string, bytes: Uint8Array = PDF) { const path = `${orgId}/calls/x/${name}`; storage.objects.set(path, { bytes }); return path; }
const attachDeck = (appId: string, path: string, name = 'deck.pdf') => filesPost(req('POST', { fieldId: F.deck, kind: 'upload', storagePath: path, fileName: name }), idp(appId)).then(read);

/** A complete application: every shown required question answered, the deck attached. Returns the ids. */
async function completeDraft() {
  const d = await draftOf(); const id = d.state.application.id;
  const attached = await attachDeck(id, putObject(ORG_A, 'deck.pdf'));
  expect(attached.status).toBe(200);
  const saved = await put(id, { [F.name]: 'Acme Robotics', [F.inc]: 'no', [F.amount]: '500000', [F.note]: 'hello', [F.deck]: attached.body.answer }, d.state.application.revision, 3);
  expect(saved.status).toBe(200);
  return { id, revision: saved.body.revision as number, file: attached.body.file as { id: string } };
}
const submit = (id: string, key: string, revision: number) => submitPost(req('POST', { key, baseRevision: revision }), idp(id)).then(read);

describe('I2 — opening the application', () => {
  it('creates the draft pre-filled from the platform\'s data (name, person, stage matched to the call\'s option), with a reference, and notes the link access', async () => {
    const d = await draftOf();
    expect(d.created).toBe(true);
    expect(d.state.application.reference).toMatch(/^APP-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(d.state.answers).toMatchObject({ [F.name]: 'Acme Robotics', [F.who]: 'Ana Test', [F.stage]: 'st-pre' });
    expect(Object.keys(d.state.answers)).not.toContain(F.note); // not linked: empty
    expect(db.tables.call_link_access).toMatchObject([{ call_id: CALL, org_id: ORG_A, user_id: 'founder-a' }]);
    expect(apps()).toMatchObject([{ call_id: CALL, startup_org_id: ORG_A, status: 'draft', unit_key: `org:${ORG_A}` }]);
    expect(d.page).toBe(1);
  });

  it('no field of the profile is a password, and the registration\'s password is nowhere in the application', async () => {
    const d = await draftOf();
    expect(JSON.stringify(d)).not.toMatch(/password|Correct-Horse/i);
    expect(JSON.stringify(apps())).not.toMatch(/password/i);
  });

  it('opening again RESUMES the same application, on the page where the applicant left off', async () => {
    const d = await draftOf();
    await put(d.state.application.id, { [F.name]: 'Acme Robotics' }, d.state.application.revision, 2);
    const again = await start();
    expect(again.body.created).toBe(false);
    expect(again.body.state.application.id).toBe(d.state.application.id);
    expect(again.body.page).toBe(2);
    expect(apps()).toHaveLength(1);
  });

  it('a field the applicant edited is NEVER overwritten by the profile again — not on reopening, not after the profile changed', async () => {
    const d = await draftOf();
    const saved = await put(d.state.application.id, { [F.name]: 'Acme Robotics Lda (edited)', [F.who]: '' }, d.state.application.revision);
    expect(saved.status).toBe(200);
    db.tables.orgs.find((o) => o.id === ORG_A)!.name = 'Renamed In Profile';
    db.tables.org_members.find((m) => m.user_id === 'founder-a')!.full_name = 'Someone Else';
    const again = await start();
    expect(again.body.state.answers[F.name]).toBe('Acme Robotics Lda (edited)');
    expect(again.body.state.answers[F.who]).toBe(''); // cleared on purpose
  });

  it('two requests at once give ONE application', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(apps()).toHaveLength(1);
    expect(a.body.state.application.id).toBe(b.body.state.application.id);
  });

  it('the limit per project: another startup has its own application; the same startup has one', async () => {
    await draftOf();
    as('founder-b');
    const b = await start();
    expect(b.status).toBe(200);
    expect(apps()).toHaveLength(2);
    expect(new Set(apps().map((a) => a.unit_key)).size).toBe(2);
  });

  it('the limit per legal entity: a second startup of the SAME company is refused', async () => {
    seed({ limit_unit: 'legal_entity' });
    db.tables.orgs.find((o) => o.id === ORG_B)!.legal_name = 'ACME robotics lda.'; db.tables.orgs.find((o) => o.id === ORG_B)!.country = 'portugal';
    await draftOf();
    as('founder-b');
    const second = await start();
    expect(second).toMatchObject({ status: 409, body: { code: 'unit_limit' } });
    expect(second.body.error).toContain('only one per company');
    expect(apps()).toHaveLength(1);
  });

  it('with several applications allowed, "start another" opens a new one (and plain opening resumes the draft)', async () => {
    seed({ allow_multiple: true });
    const first = await draftOf();
    const resumed = await start();
    expect(resumed.body.state.application.id).toBe(first.state.application.id);
    const another = await start(TOKEN, { new: true });
    expect(another.body.created).toBe(true);
    expect(another.body.state.application.id).not.toBe(first.state.application.id);
    expect(apps()).toHaveLength(2);
    expect(new Set(apps().map((a) => a.reference)).size).toBe(2);
  });

  it('a closed call cannot be applied to, but a draft started before is still there to read', async () => {
    const d = await draftOf();
    call().closes_at = new Date(Date.now() - 1000).toISOString();
    const reopened = await start();
    expect(reopened.status).toBe(200);
    expect(reopened.body.state.canEdit).toBe(false);
    expect(reopened.body.state.application.id).toBe(d.state.application.id);
    as('founder-b');
    const fresh = await start();
    expect(fresh.status).toBe(409);
    expect(fresh.body.code).toBe('closed');
    expect(fresh.body.error).toMatch(/^Applications closed on /);
    expect(apps().filter((a) => a.startup_org_id === ORG_B)).toHaveLength(0);
  });

  it('a person who is not signed in gets 401; an account without a startup 403 "startup_required"; a link that does not work 404', async () => {
    as(null);
    expect((await start()).status).toBe(401);
    as('investor-only');
    expect(await start()).toMatchObject({ status: 403, body: { code: 'startup_required' } });
    as('founder-a');
    expect((await start('does-not-exist-0123456789')).status).toBe(404);
    process.env.CALLS_MODE = 'off';
    expect((await start()).status).toBe(404);
  });
});

describe('I2 — saving the draft', () => {
  it('keeps only this call\'s questions, coerced to their type, with the page; and moves the revision', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    const saved = await put(id, { [F.name]: 'Acme', [F.amount]: '1,500.5abc', [F.inc]: 'maybe', [F.when]: '2026-02-30', injected: 'x' }, d.state.application.revision, 2);
    expect(saved).toMatchObject({ status: 200, body: { ok: true, revision: d.state.application.revision + 1 } });
    const row = apps()[0];
    expect(row.draft_answers).toEqual({ [F.name]: 'Acme', [F.amount]: '15005' });
    expect(row.last_page).toBe(2);
  });

  it('refuses a save made from an out-of-date revision (another window saved in between) without losing the newer answers', async () => {
    const d = await draftOf(); const id = d.state.application.id; const rev = d.state.application.revision;
    await put(id, { [F.name]: 'From window 1' }, rev);
    const stale = await put(id, { [F.name]: 'From window 2' }, rev);
    expect(stale).toMatchObject({ status: 409, body: { code: 'conflict' } });
    expect(apps()[0].draft_answers).toMatchObject({ [F.name]: 'From window 1' });
  });

  it('refuses a save after the call closed (the server\'s clock), and keeps what was saved before', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    await put(id, { [F.name]: 'Before the deadline' }, d.state.application.revision);
    call().closes_at = new Date(Date.now() - 1000).toISOString();
    const late = await put(id, { [F.name]: 'After' }, d.state.application.revision + 1);
    expect(late).toMatchObject({ status: 409, body: { code: 'closed' } });
    expect(apps()[0].draft_answers).toMatchObject({ [F.name]: 'Before the deadline' });
  });

  it('another startup\'s application is a 404 to read, save, attach to or submit — and an anonymous caller gets a 401', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    as('founder-b');
    expect((await appGet(req('GET'), idp(id))).status).toBe(404);
    expect((await put(id, { [F.name]: 'hijack' }, 0)).status).toBe(404);
    expect((await filesPost(req('POST', { fieldId: F.deck, kind: 'upload', storagePath: `${ORG_B}/x.pdf`, fileName: 'x.pdf' }), idp(id))).status).toBe(404);
    expect((await submit(id, 'key-12345678', 0)).status).toBe(404);
    expect(apps()[0].draft_answers).not.toMatchObject({ [F.name]: 'hijack' });
    as(null);
    expect((await appGet(req('GET'), idp(id))).status).toBe(401);
  });
});

describe('I2 — documents', () => {
  it('Prompt 927 (E): 12 MB is the ceiling whatever is stored — 11.9 MB is accepted, 12.1 MB is refused with the sentence, an old limit of 25 MB (or none) counts as 12, and the refused object is removed', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    const MB = 1024 * 1024;
    const stored = db.tables.call_form_fields.find((x) => x.id === F.deck)!;
    for (const legacy of [{ maxFileMb: 25 }, { maxFileMb: 999 }, {}]) {
      stored.validations = legacy;
      const big = putObject(ORG_A, 'big.pdf', new Uint8Array([...PDF, ...new Uint8Array(Math.round(12.05 * MB))]));
      const refused = await attachDeck(id, big, 'big.pdf');
      expect(refused.status, JSON.stringify(legacy)).toBe(400);
      expect(refused.body.error).toBe('This file is 12.1 MB. The maximum is 12 MB.');
      expect(storage.objects.has(big)).toBe(false);
    }
    stored.validations = { maxFileMb: 25 };
    const almost = await attachDeck(id, putObject(ORG_A, 'almost.pdf', new Uint8Array([...PDF, ...new Uint8Array(Math.round(11.9 * MB))])), 'almost.pdf');
    expect(almost.status, JSON.stringify(almost.body)).toBe(200);
    expect(almost.body.file.size).toBeGreaterThan(11.8 * MB);
  });

  it('an uploaded PDF is checked on the server (a real PDF by its bytes, the question\'s size limit) and registered for that question only', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    const ok = await attachDeck(id, putObject(ORG_A, 'deck.pdf'));
    expect(ok.status).toBe(200);
    expect(ok.body.file).toMatchObject({ fieldId: F.deck, source: 'upload', fileName: 'deck.pdf', size: PDF.length });
    expect(db.tables.call_application_files).toHaveLength(1);
    // A PDF by name that is not a PDF by content is refused and removed.
    const fake = putObject(ORG_A, 'fake.pdf', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect((await attachDeck(id, fake, 'fake.pdf'))).toMatchObject({ status: 400, body: { error: 'The content of “fake.pdf” is not what its name says (a renamed or damaged file), so it cannot be accepted. This question accepts PDF files (.pdf).' } });
    expect(storage.objects.has(fake)).toBe(false);
    // Over the question's limit (1 MB here).
    const big = putObject(ORG_A, 'big.pdf', new Uint8Array([...PDF, ...new Uint8Array(1024 * 1024 + 10)]));
    expect(await attachDeck(id, big, 'big.pdf')).toMatchObject({ status: 400 });
    expect(storage.objects.has(big)).toBe(false);
    // Another startup's folder, or a path that tries to leave it.
    expect((await attachDeck(id, putObject(ORG_B, 'theirs.pdf'), 'theirs.pdf')).status).toBe(403);
    expect((await attachDeck(id, `${ORG_A}/../${ORG_B}/x.pdf`, 'x.pdf')).status).toBe(403);
    expect(db.tables.call_application_files).toHaveLength(1);
  });

  it('only a document question takes a file, and a new file replaces the old one (whose uploaded object is removed)', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    expect((await filesPost(req('POST', { fieldId: F.name, kind: 'upload', storagePath: putObject(ORG_A, 'a.pdf'), fileName: 'a.pdf' }), idp(id))).status).toBe(400);
    const p1 = putObject(ORG_A, 'one.pdf'); const p2 = putObject(ORG_A, 'two.pdf');
    await attachDeck(id, p1, 'one.pdf'); await attachDeck(id, p2, 'two.pdf');
    expect(db.tables.call_application_files.map((f) => f.file_name)).toEqual(['two.pdf']);
    expect(storage.objects.has(p1)).toBe(false);
    expect(storage.objects.has(p2)).toBe(true);
  });

  it('removing a file takes the answer off the draft too', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    const a = await attachDeck(id, putObject(ORG_A, 'deck.pdf'));
    await put(id, { [F.deck]: a.body.answer }, d.state.application.revision);
    const del = await fileDelete(req('DELETE'), { params: { id, fileId: a.body.file.id } }).then(read);
    expect(del.status).toBe(200);
    expect(db.tables.call_application_files).toHaveLength(0);
    expect(apps()[0].draft_answers).not.toHaveProperty(F.deck);
  });

  describe('from the Vault', () => {
    const doc = (id: string, name: string, over: Record<string, unknown> = {}) => {
      db.tables.documents.push({ id, org_id: ORG_A, name, version: 1, storage_path: `${ORG_A}/vault/${name}`, kind: 'document', external_url: null, malware_scan_status: 'clean', deal_memo_payload: null, ...over });
      storage.objects.set(`${ORG_A}/vault/${name}`, { bytes: PDF });
    };
    const version = (docId: string, n: number, size = 800) => {
      db.tables.document_versions.push({ id: `v-${docId}-${n}`, org_id: ORG_A, document_id: docId, version: n, storage_path: `${ORG_A}/vault/${docId}-v${n}.pdf`, size, content_sha256: `sha-${n}` });
      storage.objects.set(`${ORG_A}/vault/${docId}-v${n}.pdf`, { bytes: new Uint8Array([...PDF, n]) });
    };

    it('lists only the startup\'s own PDF documents (not other types, links, deal memos, flagged files or another startup\'s)', async () => {
      const d = await draftOf();
      doc('d-pdf', 'Deck 2027.pdf'); doc('d-doc', 'Notes.docx'); doc('d-link', 'Link.pdf', { storage_path: null, external_url: 'https://x' });
      doc('d-memo', 'Memo.pdf', { deal_memo_payload: { a: 1 } }); doc('d-bad', 'Flagged.pdf', { malware_scan_status: 'flagged' });
      db.tables.documents.push({ id: 'd-other', org_id: ORG_B, name: 'Theirs.pdf', version: 1, storage_path: `${ORG_B}/Theirs.pdf`, kind: 'document', external_url: null, malware_scan_status: 'clean', deal_memo_payload: null });
      const list = await vaultGet(req('GET'), idp(d.state.application.id)).then(read);
      expect(list.body.documents.map((x: { name: string }) => x.name)).toEqual(['Deck 2027.pdf']);
    });

    it('pins the version that exists now, in the name of the call — and the Vault can then change without touching the draft', async () => {
      const d = await draftOf(); const id = d.state.application.id;
      doc('d-pdf', 'Deck.pdf'); version('d-pdf', 1);
      const r = await filesPost(req('POST', { fieldId: F.deck, kind: 'vault', documentId: 'd-pdf' }), idp(id)).then(read);
      expect(r.status).toBe(200);
      expect(r.body.file).toMatchObject({ source: 'vault', fileName: 'Deck.pdf', versionNumber: 1, documentId: 'd-pdf', size: 800 });
      expect(db.tables.call_application_files[0]).toMatchObject({ source: 'vault', document_id: 'd-pdf', version_number: 1, storage_path: `${ORG_A}/vault/d-pdf-v1.pdf`, revoked_at: null });
      expect(db.tables.call_events.some((e) => e.event === 'vault_document_authorised' && (e.detail as { authorisedFor?: string }).authorisedFor === 'call')).toBe(true);
    });

    it('a newer Vault version is OFFERED, not applied: it moves only when the applicant confirms', async () => {
      const d = await draftOf(); const id = d.state.application.id;
      doc('d-pdf', 'Deck.pdf'); version('d-pdf', 1);
      const r = await filesPost(req('POST', { fieldId: F.deck, kind: 'vault', documentId: 'd-pdf' }), idp(id)).then(read);
      version('d-pdf', 2, 900);
      const state = await appGet(req('GET'), idp(id)).then(read);
      expect(state.body.state.files[0]).toMatchObject({ versionNumber: 1, newer: { versionNumber: 2 } });
      expect(db.tables.call_application_files[0].version_number).toBe(1);
      const up = await refreshPost(req('POST'), { params: { id, fileId: r.body.file.id } }).then(read);
      expect(up).toMatchObject({ status: 200, body: { file: { versionNumber: 2, size: 900 } } });
      expect(db.tables.call_application_files[0]).toMatchObject({ version_number: 2, storage_path: `${ORG_A}/vault/d-pdf-v2.pdf` });
      expect(db.tables.call_events.some((e) => e.event === 'vault_document_updated')).toBe(true);
    });

    it('refuses a document of another startup, a non-PDF, and one over the question\'s size limit', async () => {
      const d = await draftOf(); const id = d.state.application.id;
      doc('d-doc', 'Notes.docx'); doc('d-big', 'Huge.pdf'); version('d-big', 1, 2 * 1024 * 1024);
      db.tables.documents.push({ id: 'd-other', org_id: ORG_B, name: 'Theirs.pdf', version: 1, storage_path: `${ORG_B}/Theirs.pdf`, kind: 'document', external_url: null, malware_scan_status: 'clean', deal_memo_payload: null });
      for (const documentId of ['d-doc', 'd-other', 'nope']) expect((await filesPost(req('POST', { fieldId: F.deck, kind: 'vault', documentId }), idp(id))).status, documentId).toBe(404);
      expect(await filesPost(req('POST', { fieldId: F.deck, kind: 'vault', documentId: 'd-big' }), idp(id)).then(read)).toMatchObject({ status: 400 });
      expect(db.tables.call_application_files).toHaveLength(0);
    });
  });
});

describe('I3 — submitting', () => {
  it('Prompt 927 (A): the notice is recorded only when the form SHOWED it (the pipeline never gets the application without it); a draft has none; an incubator call records nothing', async () => {
    const withNotice = await completeDraft();
    expect(apps()[0].pipeline_notice_at ?? null).toBeNull();                                    // a draft: never
    const r = await submitPost(req('POST', { key: 'key-pipe-0001', baseRevision: withNotice.revision, pipelineNotice: true }), idp(withNotice.id)).then(read);
    expect(r.status).toBe(200);
    expect(apps()[0].status).toBe('submitted');
    expect(typeof apps()[0].pipeline_notice_at).toBe('string');
    // The same request again changes nothing.
    const stamp = apps()[0].pipeline_notice_at;
    expect((await submitPost(req('POST', { key: 'key-pipe-0001', baseRevision: withNotice.revision, pipelineNotice: true }), idp(withNotice.id)).then(read)).body.already).toBe(true);
    expect(apps()[0].pipeline_notice_at).toBe(stamp);
  });

  it('Prompt 927 (A): a submission WITHOUT the notice shown is accepted but is never added to a pipeline; an incubator call records no notice either', async () => {
    const without = await completeDraft();
    expect((await submit(without.id, 'key-pipe-0002', without.revision)).status).toBe(200);
    expect(apps()[0].pipeline_notice_at ?? null).toBeNull();
    // an incubator's call: there is no investor pipeline, so nothing is recorded even when the form says so
    db.tables.calls.find((c) => c.id === CALL)!.promoter_kind = 'incubator';
    Object.assign(apps()[0], { status: 'draft', current_submission_id: null }); db.tables.call_application_submissions.length = 0;
    const again = await submitPost(req('POST', { key: 'key-pipe-0003', baseRevision: apps()[0].revision ?? without.revision, pipelineNotice: true }), idp(without.id)).then(read);
    if (again.status === 200) expect(apps()[0].pipeline_notice_at ?? null).toBeNull();
  });

  it('with something missing it lists each question and its page, and writes nothing', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    await put(id, { [F.name]: '', [F.inc]: 'yes' }, d.state.application.revision);
    const state = await appGet(req('GET'), idp(id)).then(read);
    const r = await submit(id, 'key-aaaaaaaa', state.body.state.application.revision);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('incomplete');
    expect(r.body.failures.map((f: { label: string; page: number }) => [f.label, f.page])).toEqual([['Startup name', 1], ['Incorporation date', 2], ['Pitch deck', 3]]);
    expect(db.tables.call_application_submissions).toHaveLength(0);
    expect(apps()[0].status).toBe('draft');
    expect(sent).toHaveLength(0);
  });

  it('submits: one immutable version (answers, frozen documents, the form as it was), the application is submitted, a receipt goes out once', async () => {
    const { id, revision, file } = await completeDraft();
    const r = await submit(id, 'key-0001-aaaa', revision);
    expect(r).toMatchObject({ status: 200, body: { ok: true, already: false, reference: apps()[0].reference } });
    expect(db.tables.call_application_submissions).toHaveLength(1);
    const s = db.tables.call_application_submissions[0];
    expect(s).toMatchObject({ application_id: id, version: 1, idempotency_key: 'key-0001-aaaa', submitted_by: 'founder-a' });
    expect(s.answers).toMatchObject({ [F.name]: 'Acme Robotics', [F.inc]: 'no', [F.amount]: '500000' });
    expect(s.answers).not.toHaveProperty(F.when);
    expect(s.documents).toMatchObject([{ fieldId: F.deck, fileId: file.id, fileName: 'deck.pdf', frozenPath: `calls/${CALL}/applications/${id}/frozen/${file.id}.pdf` }]);
    expect((s.form_snapshot as { callName: string; fields: unknown[] })).toMatchObject({ callName: 'Seed Call 2027', fields: expect.any(Array) });
    expect(storage.objects.has(`calls/${CALL}/applications/${id}/frozen/${file.id}.pdf`)).toBe(true);
    expect(apps()[0]).toMatchObject({ status: 'submitted', current_submission_id: s.id });
    // The receipt: an in-app notice and ONE email.
    expect(db.tables.call_notices).toMatchObject([{ user_id: 'founder-a', kind: 'submission_received', application_id: id }]);
    expect(sent.map((m) => m.to)).toEqual(['founder-a@example.com']);
    expect(sent[0].subject).toBe('Application received — Seed Call 2027');
  });

  it('is idempotent: a double click and a retry give the same submission and ONE receipt', async () => {
    const { id, revision } = await completeDraft();
    const a = await submit(id, 'key-0002-aaaa', revision);
    const b = await submit(id, 'key-0002-aaaa', revision);
    const c = await submit(id, 'key-0002-aaaa', revision + 5); // a retry after the draft moved on: still the original answer
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(b.body.already).toBe(true); expect(c.body.already).toBe(true);
    expect(b.body.submittedAt).toBe(a.body.submittedAt);
    expect(db.tables.call_application_submissions).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(db.tables.call_notices).toHaveLength(1);
  });

  it('two requests at once (same key, or different keys) produce ONE submission', async () => {
    const { id, revision } = await completeDraft();
    const same = await Promise.all([submit(id, 'key-0003-aaaa', revision), submit(id, 'key-0003-aaaa', revision)]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    expect(db.tables.call_application_submissions).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
  it('two requests at once with DIFFERENT keys: one submits, the other is told it already did', async () => {
    const { id, revision } = await completeDraft();
    const r = await Promise.all([submit(id, 'key-0004-aaaa', revision), submit(id, 'key-0004-bbbb', revision)]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(r.find((x) => x.status === 409)!.body.code).toBe('already_submitted');
    expect(db.tables.call_application_submissions).toHaveLength(1);
  });

  it('after submitting nothing can change: the draft, the files and a second submission are refused', async () => {
    const { id, revision, file } = await completeDraft();
    await submit(id, 'key-0005-aaaa', revision);
    expect(await put(id, { [F.name]: 'changed' }, revision + 1)).toMatchObject({ status: 409, body: { code: 'not_draft' } });
    expect((await attachDeck(id, putObject(ORG_A, 'other.pdf'))).status).toBe(409);
    expect((await fileDelete(req('DELETE'), { params: { id, fileId: file.id } })).status).toBe(409);
    expect(await submit(id, 'key-0005-bbbb', revision)).toMatchObject({ status: 409, body: { code: 'already_submitted' } });
    expect(db.tables.call_application_submissions).toHaveLength(1);
  });

  it('the submitted version is IMMUTABLE: the profile, the draft, the Vault and the uploaded object can all change and the application still reads as submitted', async () => {
    const { id, revision, file } = await completeDraft();
    await submit(id, 'key-0006-aaaa', revision);
    // The profile changes; the working copy is tampered with; the applicant's own copy of the file disappears.
    db.tables.orgs.find((o) => o.id === ORG_A)!.name = 'Renamed Later';
    apps()[0].draft_answers = { [F.name]: 'TAMPERED' };
    for (const path of [...storage.objects.keys()].filter((p) => p.startsWith(`${ORG_A}/`))) storage.objects.delete(path);
    const state = await appGet(req('GET'), idp(id)).then(read);
    expect(state.body.state.application.status).toBe('submitted');
    expect(state.body.state.canEdit).toBe(false);
    expect(state.body.state.answers[F.name]).toBe('Acme Robotics');
    expect(state.body.state.files).toMatchObject([{ id: file.id, fileName: 'deck.pdf' }]);
    expect(storage.objects.has(`calls/${CALL}/applications/${id}/frozen/${file.id}.pdf`)).toBe(true);
    // The table itself refuses to be changed.
    const admin = fakeCallsAdmin(db, storage);
    expect((await admin.from('call_application_submissions').update({ answers: {} }).eq('application_id', id)).error).toBeTruthy();
    expect((await admin.from('call_application_submissions').delete().eq('application_id', id)).error).toBeTruthy();
  });

  it('a required question that its condition hides does not block, and what is hidden is not submitted', async () => {
    const d = await draftOf(); const id = d.state.application.id;
    const a = await attachDeck(id, putObject(ORG_A, 'deck.pdf'));
    const saved = await put(id, { [F.name]: 'Acme', [F.inc]: 'no', [F.when]: '2020-01-01', [F.deck]: a.body.answer }, d.state.application.revision);
    const r = await submit(id, 'key-0007-aaaa', saved.body.revision);
    expect(r.status).toBe(200);
    expect(db.tables.call_application_submissions[0].answers).not.toHaveProperty(F.when);
  });

  it('refuses after the deadline, on the SERVER\'s clock — whatever the browser says — and nothing is stored', async () => {
    const { id, revision } = await completeDraft();
    call().closes_at = new Date(Date.now() - 1000).toISOString();
    const r = await submit(id, 'key-0008-aaaa', revision);
    expect(r).toMatchObject({ status: 409, body: { code: 'closed' } });
    expect(db.tables.call_application_submissions).toHaveLength(0);
    expect(apps()[0].status).toBe('draft');
  });

  it('the SQL function re-checks the clock itself: a deadline that passes between the route\'s check and the write still refuses', async () => {
    const { id, revision } = await completeDraft();
    // The route's own check passes (now is before the deadline); the database's clock is already past it.
    db.nowMs = Date.parse(call().closes_at as string) + 1000;
    const direct = await fakeCallsAdmin(db, storage).rpc('call_submit_application', { p_application: id, p_user: 'founder-a', p_key: 'key-0009-aaaa', p_answers: {}, p_documents: [], p_form_snapshot: {} });
    expect(direct.data).toMatchObject({ ok: false, reason: 'not_accepting' });
    expect(revision).toBeGreaterThan(0);
  });

  it('needs a confirmed account, and the revision the browser saved', async () => {
    const { id, revision } = await completeDraft();
    as('founder-a', false);
    expect(await submit(id, 'key-0010-aaaa', revision)).toMatchObject({ status: 403, body: { code: 'email_unconfirmed' } });
    as('founder-a');
    expect(await submit(id, 'key-0010-bbbb', revision - 1)).toMatchObject({ status: 409, body: { code: 'conflict' } });
    expect((await submit(id, 'x', revision)).status).toBe(400); // an idempotency key is required
    expect(db.tables.call_application_submissions).toHaveLength(0);
  });

  it('respects the limit per unit also at the moment of submitting', async () => {
    const { id, revision } = await completeDraft();
    // Another application of the SAME unit was submitted meanwhile (e.g. by a twin account).
    apps().push({ id: 'twin', call_id: CALL, startup_org_id: ORG_B, applicant_user_id: 'founder-b', status: 'submitted', unit_key: `org:${ORG_A}`, draft_answers: {} });
    expect(await submit(id, 'key-0011-aaaa', revision)).toMatchObject({ status: 409, body: { code: 'unit_limit' } });
    expect(db.tables.call_application_submissions).toHaveLength(0);
  });

  it('a call with several applications allowed: each application is submitted on its own', async () => {
    seed({ allow_multiple: true });
    const first = await completeDraft();
    await submit(first.id, 'key-0012-aaaa', first.revision);
    const second = await start(TOKEN, { new: true });
    expect(second.body.created).toBe(true);
    expect(apps().map((a) => a.status).sort()).toEqual(['draft', 'submitted']);
    expect(apps()[1].reference).not.toBe(apps()[0].reference);
  });

  it('the receipt carries the call\'s contact email as Reply-To when it has one, and none otherwise', async () => {
    const a = await completeDraft();
    await submit(a.id, 'key-0013-aaaa', a.revision);
    expect(sent[0].replyTo).toBeUndefined();
    seed({ contact_email: 'programme@fund.example' });
    const b = await completeDraft();
    await submit(b.id, 'key-0013-bbbb', b.revision);
    expect(sent[0].replyTo).toBe('programme@fund.example');
  });
});

// --- Prompt 929 (A): a maximum number of applications -------------------------------------------------------------------------------------------------------------------------------------------
const ORG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** A complete application for ANOTHER startup (founder-b of ORG_B, say), not submitted. */
async function completeAs(user: string, org: string, name: string) {
  as(user);
  const d = await draftOf(); const id = d.state.application.id;
  const attached = await attachDeck(id, putObject(org, 'deck.pdf'));
  expect(attached.status).toBe(200);
  const saved = await put(id, { [F.name]: name, [F.inc]: 'no', [F.amount]: '1', [F.note]: 'hi', [F.deck]: attached.body.answer }, d.state.application.revision, 3);
  expect(saved.status).toBe(200);
  return { id, revision: saved.body.revision as number };
}
const notices = (kind: string, user?: string) => db.tables.call_notices.filter((n) => n.kind === kind && (!user || n.user_id === user));
const emailsTo = (user: string) => sent.filter((m) => m.to === `${user}@example.com`);
function newcomer() {
  db.tables.orgs.push({ id: ORG_C, name: 'Late Co', legal_name: 'Late Co SA', country: 'Portugal', sector: null, stage: 'seed', website: null });
  db.tables.org_members.push({ org_id: ORG_C, user_id: 'founder-c', role: 'owner', full_name: 'Carla Late', title: 'CEO' });
  db.users.set('founder-c', { id: 'founder-c', email: 'founder-c@example.com' });
}
const TOKEN_USER = '11111111-2222-4333-8444-555555555555';

describe('929 A — the maximum number of applications', () => {
  it('only SUBMITTED applications count: drafts never fill a call; the last submission makes it Full (and says when)', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme');
    const b = await completeAs('founder-b', ORG_B, 'Other');                                   // two drafts on a call of one place: fine
    expect(apps().filter((x) => x.status === 'draft')).toHaveLength(2);
    expect(call().full_at ?? null).toBeNull();
    as('founder-a');
    expect((await submit(a.id, 'key-929-a-0001', a.revision)).status).toBe(200);
    expect(call().full_at).toBeTruthy();                                                       // it became full with this submission
    as('founder-b');
    const late = await submit(b.id, 'key-929-b-0001', b.revision);
    expect(late).toMatchObject({ status: 409, body: { ok: false, code: 'full', error: FULL_MESSAGE } });
    expect(apps().find((x) => x.id === b.id)!.status).toBe('draft');                           // the draft is kept, just not submittable
  });

  it('the race: two applicants submit at the same time for the LAST place — exactly one gets it, the other is told Full', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); const b = await completeAs('founder-b', ORG_B, 'Other');
    // Both submissions reach the database at the same moment (the SQL takes a lock of the call, counts and decides in ONE transaction; the fake models that as a single step).
    const admin = fakeCallsAdmin(db, storage);
    const go = (id: string, user: string, key: string) => admin.rpc('call_submit_application', { p_application: id, p_user: user, p_key: key, p_answers: {}, p_documents: [], p_form_snapshot: {} });
    const [r1, r2] = await Promise.all([go(a.id, 'founder-a', 'key-929-race-a'), go(b.id, 'founder-b', 'key-929-race-b')]);
    const out = [r1.data as { ok: boolean; reason?: string; became_full?: boolean }, r2.data as { ok: boolean; reason?: string; became_full?: boolean }];
    expect(out.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(out.find((r) => !r.ok)!.reason).toBe('full');                                       // the 2nd gets "Full", even if it pressed at the same time
    expect(out.find((r) => r.ok)!.became_full).toBe(true);
    expect(apps().filter((x) => x.status === 'submitted')).toHaveLength(1);
  });

  it('Full blocks STARTING too, also through the API: nothing is created, the message is the one of the page, and Sherlock Deal (not the entity) sends one email, once, with the way to stop tips', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); as('founder-a'); await submit(a.id, 'key-929-a-0002', a.revision);
    newcomer(); as('founder-c');
    const before = apps().length;
    const r = await start();
    expect(r).toMatchObject({ status: 409, body: { ok: false, code: 'full', error: FULL_MESSAGE } });
    expect(apps()).toHaveLength(before);
    expect(notices('call_full_late', 'founder-c')).toHaveLength(1);
    const mails = emailsTo('founder-c');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('«Seed Call 2027» is full');
    expect(mails[0].text).toContain('«Seed Call 2027» by «');
    expect(mails[0].text).toContain('has reached its maximum number of applications, so your application could not be submitted. You can keep using Sherlock Deal: complete your startup profile to be found by investors that match your stage and sector, and to hear about new opportunities.');
    expect(mails[0].html).toContain('Unsubscribe from Sherlock Deal tips');
    expect(mails[0].text).toMatch(/\/api\/email\/unsubscribe\?t=/);
    expect(mails[0].replyTo).toBeUndefined();                                                  // it is Sherlock Deal's, not the entity's
    await start(); await start();                                                              // trying again changes nothing: still one email
    expect(emailsTo('founder-c')).toHaveLength(1);
  });

  it('the email goes only to whoever has not refused tips; the message on the screen is the same either way', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); as('founder-a'); await submit(a.id, 'key-929-a-0003', a.revision);
    newcomer(); db.tables.user_email_preferences.push({ user_id: 'founder-c', tips_opt_out: true, announcements_opt_out: false });
    as('founder-c');
    expect((await start()).body.error).toBe(FULL_MESSAGE);
    expect(emailsTo('founder-c')).toHaveLength(0);
    expect(notices('call_full_late', 'founder-c')).toHaveLength(1);                            // the in-app notice is not an email: it stays
  });

  it('whoever had a draft is told once, BY THE ENTITY, when the call fills up — not the one who filled it', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); await completeAs('founder-b', ORG_B, 'Other');
    as('founder-a'); await submit(a.id, 'key-929-a-0004', a.revision);
    expect(notices('call_full', 'founder-b')).toHaveLength(1);
    expect(notices('call_full', 'founder-a')).toHaveLength(0);
    expect(notices('call_full', 'founder-b')[0].title).toBe('«Seed Call 2027» has reached its maximum number of applications');
    expect(emailsTo('founder-b').filter((m) => m.subject.includes('maximum number'))).toHaveLength(1);
  });

  it('raising or removing the limit opens the call again and tells the drafts once; the second place fills it again', async () => {
    call().max_applications = 1;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); const b = await completeAs('founder-b', ORG_B, 'Other');
    as('founder-a'); await submit(a.id, 'key-929-a-0005', a.revision);
    expect(call().full_at).toBeTruthy();
    const { rowToCall } = await import('@/lib/calls/mappers');
    const raised = await setCallLimit(fakeCallsAdmin(db, storage), rowToCall(call()), { max_applications: 2 }, 'zz-test-firm');
    expect(raised!.fullAt ?? null).toBeNull();
    expect(call().full_at ?? null).toBeNull();
    expect(notices('call_reopened', 'founder-b')).toHaveLength(1);
    expect(notices('call_reopened', 'founder-b')[0].title).toBe('«Seed Call 2027» is accepting applications again');
    as('founder-b');
    expect((await submit(b.id, 'key-929-b-0005', b.revision)).status).toBe(200);              // it can be submitted now
    expect(call().full_at).toBeTruthy();                                                        // and the second place filled it again
    await setCallLimit(fakeCallsAdmin(db, storage), rowToCall(call()), { max_applications: null }, 'zz-test-firm');   // removing the limit
    expect(call().full_at ?? null).toBeNull();
  });

  it('the entry page says "Full" (never "Closed"), shows the places left only when the team chose to, and the maximum is a whole number of at least 1', async () => {
    call().max_applications = 3; call().show_places_left = false;
    const a = await completeAs('founder-a', ORG_A, 'Acme'); as('founder-a'); await submit(a.id, 'key-929-a-0006', a.revision);
    const page = async () => (await read(await publicGet(req('GET'), { params: { token: TOKEN } }))).body;
    expect(await page()).toMatchObject({ ok: true, phase: 'open', full: false, placesLeft: null, message: null });
    call().show_places_left = true;
    expect((await page()).placesLeft).toBe(2);
    call().max_applications = 1;
    expect(await page()).toMatchObject({ phase: 'open', full: true, message: FULL_MESSAGE, placesLeft: 0 });
    const { parseGeneralPatch } = await import('@/lib/calls/mappers');
    for (const bad of [0, -3, 1.5, 'ten', 2_000_000]) expect(parseGeneralPatch({ maxApplications: bad }, { opensAt: null, closesAt: null }), String(bad)).toMatchObject({ ok: false });
    expect(parseGeneralPatch({ maxApplications: '' }, { opensAt: null, closesAt: null })).toMatchObject({ ok: true, patch: { max_applications: null } });
    expect(parseGeneralPatch({ maxApplications: 200 }, { opensAt: null, closesAt: null })).toMatchObject({ ok: true, patch: { max_applications: 200 } });
  });

  it('the link in the email turns the choice off for that account, is recorded, and cannot be forged; "undo" turns it back on', async () => {
    const link = (token: string | null, extra = '') => unsubscribeGet(new Request(`http://localhost/api/email/unsubscribe?t=${token ?? ''}${extra}`));
    const token = preferenceToken(TOKEN_USER, 'tips_opt_out')!;
    const ok = await link(token);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('You will no longer receive tips from Sherlock Deal');
    expect(db.tables.user_email_preferences.find((p) => p.user_id === TOKEN_USER)).toMatchObject({ tips_opt_out: true });
    expect(db.tables.user_email_preference_changes).toMatchObject([{ preference: 'tips_opt_out', value: true, via: 'link in an email' }]);
    await link(token);                                                                          // following it again changes nothing
    expect(db.tables.user_email_preference_changes).toHaveLength(1);
    await link(token, '&undo=1');
    expect(db.tables.user_email_preferences.find((p) => p.user_id === TOKEN_USER)).toMatchObject({ tips_opt_out: false });
    expect(db.tables.user_email_preference_changes).toHaveLength(2);
    for (const forged of [null, 'abc', `${token}x`, token.replace(/\.[0-9a-f]{4}/, '.0000')]) expect((await link(forged)).status, String(forged)).toBe(400);
  });
});
