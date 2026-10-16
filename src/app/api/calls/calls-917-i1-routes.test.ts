// Prompt 917, I1 — the new kinds of question, through the real handlers over the stateful fake database: what the applicant can attach and in which formats
// (checked on the BYTES; a ZIP never), several files, files per entry of a group, the group's counts and required questions, pre-defined rows, the final check,
// the immutable version, and what the entity reads in "Submissions" — links that open in a new tab, groups as cards or tables, every file.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';
import { docx, exe, jpeg, plainZip, pptx, zipNamedAsOffice } from '@/lib/calls/ai-import/test-fixtures';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at: string | null } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', () => ({ resendConfigured: true, transactionalTemplate: () => '', sendTransactionalEmail: async () => ({ sent: true, id: 'em_1' }) }));
vi.mock('@/lib/upload-security', async (orig) => ({ ...(await orig<typeof import('@/lib/upload-security')>()), scanWithVirusTotal: async () => ({ status: 'clean', provider: null, detail: '' }) }));

import { POST as startPost } from './apply/[token]/start/route';
import { GET as appGet, PUT as appPut } from './apply/applications/[id]/route';
import { POST as filesPost } from './apply/applications/[id]/files/route';
import { DELETE as fileDelete } from './apply/applications/[id]/files/[fileId]/route';
import { POST as submitPost } from './apply/applications/[id]/submit/route';
import { GET as detailGet } from './[id]/submissions/[applicationId]/route';
import { GET as docGet } from './[id]/submissions/[applicationId]/documents/[fileId]/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tok-917-i1-0123456789abcdef';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DAY = 86_400_000;
const F = {
  name: 'f0000000-0000-4000-8000-000000000001', link: 'f0000000-0000-4000-8000-000000000002', mail: 'f0000000-0000-4000-8000-000000000003',
  others: 'f0000000-0000-4000-8000-000000000004', team: 'f0000000-0000-4000-8000-000000000005', photo: 'f0000000-0000-4000-8000-000000000006',
  competitors: 'f0000000-0000-4000-8000-000000000007',
};
const T = { name: 'a0000000-0000-4000-8000-000000000001', email: 'a0000000-0000-4000-8000-000000000002', cv: 'a0000000-0000-4000-8000-000000000003' };
const C = { name: 'b0000000-0000-4000-8000-000000000001', strengths: 'b0000000-0000-4000-8000-000000000002' };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a]);

const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls/apply', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})), res });
const idp = (id: string) => ({ params: { id } });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const put = (id: string, answers: Record<string, unknown>, baseRevision: number, lastPage = 1) => appPut(req('PUT', { answers, lastPage, baseRevision }), idp(id)).then(read);

function seed() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; db.nowMs = undefined; db.clock = Date.now();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  db.tables.calls.push({
    id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'Seed Call 2027', description: 'Summary', status: 'open',
    opens_at: new Date(Date.now() - 2 * DAY).toISOString(), closes_at: new Date(Date.now() + 5 * DAY).toISOString(), timezone: 'Europe/Lisbon', visibility: 'unlisted',
    limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', link_token: TOKEN, config_version: 3, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', contact_email: null,
  });
  const f = (id: string, kind: string, label: string, page: number, position: number, extra: Record<string, unknown> = {}) =>
    db.tables.call_form_fields.push({ id, call_id: CALL, kind, label, page, position, required: false, options: [], validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null, ...extra });
  f(F.name, 'short_text', 'Startup name', 1, 0, { required: true });
  f(F.link, 'url', 'Pitch video', 1, 1, { required: true, validations: { urlHint: 'video' } });
  f(F.mail, 'email', 'Contact email', 1, 2);
  f(F.others, 'file', 'Other relevant documents', 2, 0, { validations: { maxFiles: 3, fileFormats: ['pdf', 'word'], maxFileMb: 1 } });
  f(F.photo, 'file', 'Team photo', 2, 1, { validations: { fileFormats: ['image'] } });
  f(F.team, 'group', 'Team', 2, 2, { required: true, validations: { group: {
    entryLabel: 'Team member', min: 1, max: 3, display: 'cards', presetRows: [],
    subFields: [
      { id: T.name, kind: 'short_text', label: 'Name', required: true, options: [], validations: {} },
      { id: T.email, kind: 'email', label: 'Email', required: true, options: [], validations: {} },
      { id: T.cv, kind: 'file', label: 'CV', required: false, options: [], validations: { maxFileMb: 5 } },
    ],
  } } });
  f(F.competitors, 'group', 'Competitor analysis', 3, 0, { validations: { group: {
    entryLabel: 'Row', min: 2, max: 2, display: 'table', presetRows: [['Your company'], ['Competitor 1']],
    subFields: [
      { id: C.name, kind: 'short_text', label: 'Company', required: false, options: [], validations: {} },
      { id: C.strengths, kind: 'long_text', label: 'Strengths', required: true, options: [], validations: {} },
    ],
  } } });
  db.tables.orgs.push({ id: ORG_A, name: 'Acme Robotics', legal_name: 'Acme Robotics, Lda', country: 'Portugal', sector: 'Industrial', stage: 'pre_seed', website: 'https://acme.example' });
  db.tables.org_members.push({ org_id: ORG_A, user_id: 'founder-a', role: 'owner', full_name: 'Ana Test', title: 'CEO' });
  db.users.set('founder-a', { id: 'founder-a', email: 'founder-a@example.com' });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  as('founder-a');
}
beforeEach(() => seed());

const draft = async () => {
  const s = await startPost(req('POST', {}), { params: { token: TOKEN } }).then(read);
  expect(s.status).toBe(200);
  return s.body.state as { application: { id: string; revision: number }; answers: Record<string, unknown>; orgId: string };
};
const putObject = (name: string, bytes: Uint8Array | Buffer) => { const path = `${ORG_A}/calls/x/${name}`; storage.objects.set(path, { bytes: new Uint8Array(bytes) }); return path; };
const attach = (appId: string, fieldId: string, name: string, bytes: Uint8Array | Buffer, entryId?: string) =>
  filesPost(req('POST', { fieldId, entryId, kind: 'upload', storagePath: putObject(name, bytes), fileName: name }), idp(appId)).then(read);
const apps = () => db.tables.call_applications;

describe('a link and an email', () => {
  it('a half-typed link survives the autosave; submitting with it says what is wrong; a good one lets it through', async () => {
    const d = await draft();
    const saved = await put(d.application.id, { [F.name]: 'Acme', [F.link]: 'www.youtube.com/watch?v=1', [F.mail]: 'ana@' }, d.application.revision);
    expect(saved.status).toBe(200);
    const again = await appGet(req('GET'), idp(d.application.id)).then(read);
    expect(again.body.state.answers).toMatchObject({ [F.link]: 'www.youtube.com/watch?v=1', [F.mail]: 'ana@' });
    const refused = await submitPost(req('POST', { key: 'key-0001-link', baseRevision: saved.body.revision }), idp(d.application.id)).then(read);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const names = (refused.body.failures as { label: string; message: string }[]).map((x) => `${x.label}: ${x.message}`);
    expect(names).toContain('Pitch video: Enter a link that starts with http:// or https://.');
    expect(names).toContain('Contact email: Enter a valid email address.');
  });
});

describe('files: the real format, several files, never a ZIP', () => {
  it('accepts the formats the question takes — checked on the bytes — and refuses the rest with the reason', async () => {
    const d = await draft(); const id = d.application.id;
    expect((await attach(id, F.others, 'plan.pdf', PDF)).status).toBe(200);
    expect((await attach(id, F.others, 'cv.docx', docx(['Curriculum']))).status).toBe(200);
    // a presentation: not among the formats of this question
    expect(await attach(id, F.others, 'deck.pptx', pptx())).toMatchObject({ status: 400, body: { error: 'Only PDF or Word files are accepted.' } });
    // a ZIP: never, whatever it is called
    expect(await attach(id, F.others, 'bundle.zip', plainZip())).toMatchObject({ status: 400, body: { error: expect.stringContaining('ZIP files are not accepted') } });
    expect(await attach(id, F.others, 'cv2.docx', zipNamedAsOffice())).toMatchObject({ status: 400, body: { error: 'Only PDF or Word files are accepted.' } });
    // by its bytes, not its name: a program called .pdf, and a Word file called .pdf
    expect((await attach(id, F.others, 'invoice.pdf', exe())).status).toBe(400);
    expect((await attach(id, F.others, 'really-word.pdf', docx(['x']))).status).toBe(400);
    // a picture on a question that takes pictures, and not on one that does not
    expect((await attach(id, F.photo, 'team.jpg', jpeg())).status).toBe(200);
    expect((await attach(id, F.others, 'team.jpg', jpeg())).status).toBe(400);
    expect((await attach(id, F.photo, 'plan.pdf', PDF)).status).toBe(400);
    // the refused ones left nothing behind
    expect(db.tables.call_application_files.map((r) => r.file_name).sort()).toEqual(['cv.docx', 'plan.pdf', 'team.jpg']);
  });

  it('a question that takes several files adds each as its own entry, up to its maximum — and the size limit is per file', async () => {
    const d = await draft(); const id = d.application.id;
    const a = await attach(id, F.others, 'a.pdf', PDF);
    const b = await attach(id, F.others, 'b.pdf', PDF);
    const c = await attach(id, F.others, 'c.pdf', PDF);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(await attach(id, F.others, 'd.pdf', PDF)).toMatchObject({ status: 400, body: { error: 'You can attach at most 3 files here.' } });
    expect(db.tables.call_application_files.filter((r) => r.field_id === F.others)).toHaveLength(3);
    const big = new Uint8Array(1024 * 1024 + 10); big.set(PDF);
    expect((await attach(id, F.others, 'big.pdf', big)).status).toBe(400);                           // over this question's 1 MB
    // remove one: room for another
    expect((await fileDelete(req('DELETE'), { params: { id, fileId: a.body.file.id } })).status).toBe(200);
    expect((await attach(id, F.others, 'e.pdf', PDF)).status).toBe(200);
  });

  it('inside a group each entry has its own file: a second entry\'s CV does not replace the first\'s; replacing one touches only its entry', async () => {
    const d = await draft(); const id = d.application.id;
    expect((await attach(id, T.cv, 'cv.pdf', PDF)).status).toBe(400);                                // which entry?
    const a = await attach(id, T.cv, 'cv-ana.pdf', PDF, 'entry-ana');
    const b = await attach(id, T.cv, 'cv-bruno.pdf', PDF, 'entry-bruno');
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.tables.call_application_files.map((r) => [r.file_name, r.entry_id]).sort()).toEqual([['cv-ana.pdf', 'entry-ana'], ['cv-bruno.pdf', 'entry-bruno']]);
    const a2 = await attach(id, T.cv, 'cv-ana-2.pdf', PDF, 'entry-ana');
    expect(a2.status).toBe(200);
    expect(db.tables.call_application_files.map((r) => r.file_name).sort()).toEqual(['cv-ana-2.pdf', 'cv-bruno.pdf']);       // Ana's old CV replaced, Bruno's untouched
    expect((await attach(id, C.name, 'x.pdf', PDF, 'row1')).status).toBe(400);                        // not a document question
  });

  it('removing a file takes it out of the draft wherever it was: a list, an entry of a group', async () => {
    const d = await draft(); const id = d.application.id;
    const cv = await attach(id, T.cv, 'cv-ana.pdf', PDF, 'entry-ana');
    const saved = await put(id, { [F.team]: [{ id: 'entry-ana', values: { [T.name]: 'Ana', [T.cv]: cv.body.answer } }] }, d.application.revision);
    expect(saved.status).toBe(200);
    const kept = await appGet(req('GET'), idp(id)).then(read);
    expect((kept.body.state.answers[F.team] as { values: Record<string, unknown> }[])[0].values[T.cv]).toMatchObject({ fileName: 'cv-ana.pdf', fileId: cv.body.file.id });
    const del = await fileDelete(req('DELETE'), { params: { id, fileId: cv.body.file.id } }).then(read);
    expect(del.status).toBe(200);
    const after = await appGet(req('GET'), idp(id)).then(read);
    const values = (after.body.state.answers[F.team] as { values: Record<string, unknown> }[])[0].values;
    expect(values[T.name]).toBe('Ana');
    expect(values[T.cv]).toBeUndefined();
  });
});

describe('a repeatable group, and a table with rows the entity set', () => {
  it('is kept as entries; more than the maximum is cut; pre-defined rows are the entity\'s whatever the browser sends', async () => {
    const d = await draft(); const id = d.application.id;
    const entries = ['a', 'b', 'c', 'd'].map((x) => ({ id: `entry-${x}`, values: { [T.name]: x, [T.email]: `${x}@example.pt` } }));
    const saved = await put(id, {
      [F.team]: entries,
      [F.competitors]: [{ id: 'hacked-1', values: { [C.name]: 'HACKED', [C.strengths]: 'ours' } }, { id: 'hacked-2', values: { [C.strengths]: 'theirs' } }, { id: 'hacked-3', values: { [C.strengths]: 'third' } }],
    }, d.application.revision);
    expect(saved.status).toBe(200);
    const s = (await appGet(req('GET'), idp(id)).then(read)).body.state.answers as Record<string, { id: string; values: Record<string, unknown> }[]>;
    expect(s[F.team].map((e) => e.id)).toEqual(['entry-a', 'entry-b', 'entry-c']);
    expect(s[F.competitors].map((r) => [r.id, r.values[C.name], r.values[C.strengths]])).toEqual([['row1', 'Your company', 'ours'], ['row2', 'Competitor 1', 'theirs']]);
  });

  it('on submitting: the number of entries and each entry\'s required questions are checked on the server, naming the entry and the question', async () => {
    const d = await draft(); const id = d.application.id;
    const incomplete = await put(id, { [F.name]: 'Acme', [F.link]: 'https://youtu.be/abc', [F.team]: [{ id: 'entry-a', values: { [T.name]: 'Ana' } }], [F.competitors]: [{ id: 'x', values: { [C.strengths]: 'cheap' } }] }, d.application.revision);
    const r = await submitPost(req('POST', { key: 'key-0002-grp', baseRevision: incomplete.body.revision }), idp(id)).then(read);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const msgs = (r.body.failures as { label: string; message: string }[]).map((x) => `${x.label}: ${x.message}`);
    expect(msgs).toContain('Team: Team member 1 — Email: This answer is required.');
    expect(msgs.some((m) => m.startsWith('Competitor analysis:'))).toBe(true);                         // the table's "Strengths" are required in every row
    expect(apps()[0].status).toBe('draft');
  });
});

describe('the submitted version, and what the entity reads', () => {
  async function complete() {
    const d = await draft(); const id = d.application.id;
    const others = await Promise.all([attach(id, F.others, 'plan.pdf', PDF), attach(id, F.others, 'cv.docx', docx(['Curriculum']))]);
    const cvA = await attach(id, T.cv, 'cv-ana.pdf', PDF, 'entry-ana');
    const photo = await attach(id, F.photo, 'team.jpg', jpeg());
    const saved = await put(id, {
      [F.name]: 'Acme Robotics', [F.link]: 'https://youtu.be/abc123', [F.mail]: 'hello@acme.example',
      [F.others]: others.map((o) => o.body.answer), [F.photo]: photo.body.answer,
      [F.team]: [{ id: 'entry-ana', values: { [T.name]: 'Ana', [T.email]: 'ana@acme.example', [T.cv]: cvA.body.answer } }, { id: 'entry-bruno', values: { [T.name]: 'Bruno', [T.email]: 'bruno@acme.example' } }],
      [F.competitors]: [{ id: 'x', values: { [C.strengths]: 'cheap' } }, { id: 'y', values: { [C.name]: 'ignored', [C.strengths]: 'big' } }],
    }, d.application.revision, 3);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const r = await submitPost(req('POST', { key: 'key-0003-complete', baseRevision: saved.body.revision }), idp(id)).then(read);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { id, files: { others: others.map((o) => o.body.file.id as string), cv: cvA.body.file.id as string, photo: photo.body.file.id as string } };
  }

  it('a complete application is submitted; every file is frozen with its own extension, including those inside entries and lists', async () => {
    const { files } = await complete();
    const rows = db.tables.call_application_files;
    for (const [id, ext] of [[files.others[0], 'pdf'], [files.others[1], 'docx'], [files.cv, 'pdf'], [files.photo, 'jpg']] as const) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.frozen_path, String(row.file_name)).toMatch(new RegExp(`/frozen/${id}\\.${ext}$`));
      expect(storage.objects.has(row.frozen_path as string)).toBe(true);
    }
    expect(db.tables.call_application_submissions).toHaveLength(1);
  });

  it('the submitted version never changes: not with the form, not with the profile, not with the Vault — and it is read as it was answered', async () => {
    const { id } = await complete();
    const before = JSON.stringify(db.tables.call_application_submissions[0]);
    // the entity edits the call's form afterwards (as far as the data goes), the profile changes
    // (replaced, not edited in place: the fake database shares object references where a real one stores a copy)
    const row = db.tables.call_form_fields.find((f) => f.id === F.team)!;
    row.label = 'People';
    row.validations = { group: { ...(row.validations as { group: object }).group, entryLabel: 'Person' } };
    db.tables.orgs.find((o) => o.id === ORG_A)!.name = 'Renamed';
    expect(JSON.stringify(db.tables.call_application_submissions[0])).toBe(before);
    const again = await appGet(req('GET'), idp(id)).then(read);
    expect(again.body.state.application.status).toBe('submitted');
    const team = again.body.state.answers[F.team] as { values: Record<string, unknown> }[];
    expect(team.map((e) => e.values[T.name])).toEqual(['Ana', 'Bruno']);
    // the form as it was when it was submitted keeps the group's own configuration
    const snap = (db.tables.call_application_submissions[0].form_snapshot as { fields: { id: string; validations: { group?: { entryLabel: string; subFields: unknown[] } } }[] });
    expect(snap.fields.find((f) => f.id === F.team)!.validations.group).toMatchObject({ entryLabel: 'Team member' });
    expect(snap.fields.find((f) => f.id === F.team)!.validations.group!.subFields).toHaveLength(3);
  });

  it('the entity reads it all in Submissions: a link (opened elsewhere), several files, a group per entry, the table with its fixed rows — read-only', async () => {
    const { id, files } = await complete();
    as('ana');
    const d = await read(await detailGet(req('GET'), { params: { id: CALL, applicationId: id } }));
    expect(d.status).toBe(200);
    expect(d.body.answers[F.link]).toBe('https://youtu.be/abc123');
    expect(d.body.fields.map((f: { kind: string }) => f.kind)).toEqual(expect.arrayContaining(['url', 'email', 'file', 'group']));
    const docs = d.body.documents as { fileId: string; fileName: string; url: string }[];
    expect(docs.map((x) => x.fileName).sort()).toEqual(['cv-ana.pdf', 'cv.docx', 'plan.pdf', 'team.jpg']);
    for (const f of [...files.others, files.cv, files.photo]) {
      const dl = await docGet(req('GET'), { params: { id: CALL, applicationId: id, fileId: f } });
      expect(dl.status).toBe(302);
    }
    const rows = (d.body.answers[F.competitors] as { values: Record<string, string> }[]);
    expect(rows.map((r) => r.values[C.name])).toEqual(['Your company', 'Competitor 1']);
    expect(rows.map((r) => r.values[C.strengths])).toEqual(['cheap', 'big']);
  });
});
