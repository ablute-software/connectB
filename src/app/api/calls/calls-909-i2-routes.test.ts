// Prompt 909, I2 — importing the form of another call, through the real handlers: only calls of the same
// organisation (archived included), Replace and Add, the confirmation for Replace, the lock, the event, and who may.
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
import { GET as importGet, POST as importPost } from './[id]/import-form/route';
import { POST as actionPost } from './[id]/action/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const json = (method: string, body?: unknown, url = 'http://localhost/api/calls/x/import-form') => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (userId: string) => { currentUser = { id: userId, email: `${userId}@example.com` }; };
function member(userId: string, entity: string, role: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: `m-${userId}-${entity.slice(0, 2)}`, user_id: userId, catalog_entity_id: entity, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
}
async function newCall(name: string, user = 'ana') {
  as(user);
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name }, 'http://localhost/api/calls')));
  return created.body.call as { id: string; configVersion: number };
}
let fieldSeq = 0;
function addField(callId: string, over: Record<string, unknown>) {
  db.tables.call_form_fields.push({ id: `fld-${++fieldSeq}-${callId.slice(-4)}`, call_id: callId, kind: 'short_text', label: 'Q', page: 1, position: 0, options: [], validations: {}, ...over });
  return `fld-${fieldSeq}-${callId.slice(-4)}`;
}
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const fieldsOf = (id: string) => db.tables.call_form_fields.filter((f) => f.call_id === id);
const post = (id: string, body: unknown) => importPost(json('POST', body), params(id)).then(read);

let source: { id: string };
let target: { id: string };

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' }, { id: OTHER, name: 'zz-test-other' });
  member('ana', FIRM, 'admin'); member('bob', FIRM, 'member'); member('otto', OTHER, 'admin');
  currentUser = null;
  source = await newCall('Edition 2025');
  const yn = addField(source.id, { kind: 'yes_no', label: 'Incorporated?', page: 1, position: 0, required: true, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
  addField(source.id, { kind: 'date', label: 'Date of incorporation', page: 1, position: 1, condition: { fieldId: yn, operator: 'equals', value: 'yes' } });
  addField(source.id, { kind: 'file', label: 'Certificate', page: 2, position: 0, expected_type: 'Registration certificate', max_age_months: 6 });
  target = await newCall('Edition 2026');
});

describe('which calls it offers', () => {
  it('the other calls of the same organisation, archived included, with their number of fields; never another organisation\'s', async () => {
    row(source.id).status = 'closed';
    const archived = await newCall('Edition 2024'); row(archived.id).status = 'archived';
    const foreign = await newCall('Not yours', 'otto');
    void foreign;
    as('ana');
    const res = await read(await importGet(json('GET'), params(target.id)));
    expect(res.status).toBe(200);
    const names = res.body.sources.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(['Edition 2024', 'Edition 2025']);
    expect(res.body.sources.find((s: { name: string }) => s.name === 'Edition 2025')).toMatchObject({ fields: 3, effectiveStatus: 'closed' });
    expect(res.body.sources.find((s: { name: string }) => s.name === 'Edition 2024').effectiveStatus).toBe('archived');
  });

  it('shows the fields of one of them before importing, and refuses to show another organisation\'s', async () => {
    as('ana');
    const ok = await read(await importGet(json('GET', undefined, `http://localhost/x?preview=${source.id}`), params(target.id)));
    expect(ok.body.preview).toMatchObject({ name: 'Edition 2025', fields: expect.any(Array) });
    expect(ok.body.preview.fields).toHaveLength(3);
    const foreign = await newCall('Not yours', 'otto');
    as('ana');
    expect((await read(await importGet(json('GET', undefined, `http://localhost/x?preview=${foreign.id}`), params(target.id)))).status).toBe(404);
  });
});

describe('importing', () => {
  it('Add: the imported form comes after the existing one, which is untouched; a new version; an event says where it came from', async () => {
    addField(target.id, { label: 'Existing question', page: 1, position: 0 });
    const before = row(target.id).config_version as number;
    const res = await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: before });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.import).toMatchObject({ imported: 3, mode: 'add', from: 'Edition 2025', warnings: [] });
    const fields = fieldsOf(target.id).sort((a, b) => (a.page as number) - (b.page as number) || (a.position as number) - (b.position as number));
    expect(fields.map((f) => f.label)).toEqual(['Existing question', 'Incorporated?', 'Date of incorporation', 'Certificate']);
    expect(fields.map((f) => f.page)).toEqual([1, 2, 2, 3]);
    expect(row(target.id).config_version).toBe(before + 1);
    expect(db.tables.call_events.filter((e) => e.call_id === target.id && e.event === 'form_imported')).toMatchObject([
      { actor_user_id: 'ana', detail: { fromCallId: source.id, fromName: 'Edition 2025', mode: 'add', imported: 3 } },
    ]);
    // the source is untouched
    expect(fieldsOf(source.id)).toHaveLength(3);
  });

  it('the imported conditions, mappings and expected documents come along, on new ids', async () => {
    await post(target.id, { sourceCallId: source.id, mode: 'replace', baseVersion: row(target.id).config_version });
    const fields = fieldsOf(target.id);
    const yn = fields.find((f) => f.label === 'Incorporated?')!;
    const date = fields.find((f) => f.label === 'Date of incorporation')!;
    expect(date.condition).toMatchObject({ fieldId: yn.id, operator: 'equals', value: 'yes' });
    expect(fields.find((f) => f.label === 'Certificate')).toMatchObject({ expected_type: 'Registration certificate', max_age_months: 6 });
    const sourceIds = new Set(fieldsOf(source.id).map((f) => f.id));
    expect(fields.every((f) => !sourceIds.has(f.id))).toBe(true);
  });

  it('Replace over a form that has fields asks for confirmation first; confirmed, it replaces', async () => {
    addField(target.id, { label: 'Old one' }); addField(target.id, { label: 'Old two', position: 1 });
    const base = row(target.id).config_version;
    const asked = await post(target.id, { sourceCallId: source.id, mode: 'replace', baseVersion: base });
    expect(asked).toMatchObject({ status: 409, body: { code: 'confirm_replace', existingFields: 2 } });
    expect(fieldsOf(target.id)).toHaveLength(2);
    const done = await post(target.id, { sourceCallId: source.id, mode: 'replace', baseVersion: base, confirmReplace: true });
    expect(done.status).toBe(200);
    expect(fieldsOf(target.id).map((f) => f.label).sort()).toEqual(['Certificate', 'Date of incorporation', 'Incorporated?']);
  });

  it('Replace over an empty form needs no confirmation', async () => {
    expect((await post(target.id, { sourceCallId: source.id, mode: 'replace', baseVersion: row(target.id).config_version })).status).toBe(200);
  });

  it('is refused while the configuration is locked, with the lock sentence; "Edit configuration" lifts it', async () => {
    row(target.id).status = 'validated';
    const locked = await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: row(target.id).config_version });
    expect(locked).toMatchObject({ status: 409, body: { code: 'locked' } });
    expect(locked.body.error).toContain('Edit configuration');
    expect(fieldsOf(target.id)).toHaveLength(0);
    as('ana');
    expect((await actionPost(json('POST', { action: 'edit' }, 'http://localhost/x'), params(target.id)).then(read)).status).toBe(200);
    expect((await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: row(target.id).config_version })).status).toBe(200);
  });

  it('is refused for a call of another organisation, for the call itself, for a call without a form, and with a stale version', async () => {
    const foreign = await newCall('Not yours', 'otto'); addField(foreign.id, { label: 'Secret' });
    as('ana');
    const base = row(target.id).config_version as number;
    expect((await post(target.id, { sourceCallId: foreign.id, mode: 'add', baseVersion: base })).status).toBe(404);
    expect((await post(target.id, { sourceCallId: target.id, mode: 'add', baseVersion: base })).status).toBe(400);
    const empty = await newCall('Empty'); as('ana');
    expect((await post(target.id, { sourceCallId: empty.id, mode: 'add', baseVersion: base })).body.error).toContain('no form');
    expect((await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: base - 1 })).body.code).toBe('conflict');
    expect((await post(target.id, { sourceCallId: source.id, mode: 'maybe', baseVersion: base })).status).toBe(400);
    expect(fieldsOf(target.id)).toHaveLength(0);
    expect(fieldsOf(foreign.id)).toHaveLength(1);
  });

  it('a plain member and a signed-out caller cannot import', async () => {
    as('bob');
    expect((await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: row(target.id).config_version })).status).toBe(403);
    currentUser = null;
    expect((await post(target.id, { sourceCallId: source.id, mode: 'add', baseVersion: row(target.id).config_version })).status).toBe(401);
    expect(fieldsOf(target.id)).toHaveLength(0);
  });
});
