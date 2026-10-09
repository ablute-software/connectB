// Prompt 905 — the Calls routes through their real handlers, the real access rules and the real store, over a
// stateful fake database: the switch, who may see and who may edit, isolation between entities, autosave under
// optimistic concurrency, validation by the server, the whole life of a call (confirm -> publish -> opens by
// itself -> extend -> close), duplication and the public link. Only the session is stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let currentUser: { id: string; email: string } | null;
let incubatorMember: { id: string; incubatorId: string; role: string; incubatorName: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => incubatorMember }));

import { GET as listGet, POST as createPost } from './route';
import { GET as accessGet } from './access/route';
import { GET as oneGet, PATCH as onePatch } from './[id]/route';
import { PUT as phasesPut } from './[id]/phases/route';
import { PUT as formPut } from './[id]/form/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as actionPost } from './[id]/action/route';
import { GET as publicGet } from './public/[token]/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const OTHER_FIRM = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });

function member(userId: string, entity: string, role: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: `m-${userId}-${entity.slice(0, 4)}`, user_id: userId, catalog_entity_id: entity, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
}
const as = (userId: string) => { currentUser = { id: userId, email: `${userId}@example.com` }; };

const FIELDS: Record<string, unknown>[] = [
  { id: 'inc-0000-0001', kind: 'yes_no', label: 'Is the company incorporated?', required: true, page: 1, position: 0 },
  { id: 'dat-0000-0002', kind: 'date', label: 'Date of incorporation', required: true, page: 1, position: 1, condition: { fieldId: 'inc-0000-0001', operator: 'equals', value: 'yes' } },
  { id: 'rev-0000-0003', kind: 'number', label: 'Revenue last year', page: 1, position: 2, validations: { currency: true } },
];

async function newCall(userId = 'ana', name = 'Seed Call') {
  as(userId);
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  expect(created.status).toBe(200);
  return created.body.call as { id: string; configVersion: number };
}

/** Fill a draft with valid general data, a phase and a form. Returns the latest version. */
async function readyCall(id: string) {
  let version = (await read(await oneGet(json('GET'), params(id)))).body.call.configVersion as number;
  const general = await read(await onePatch(json('PATCH', { baseVersion: version, opensAt: inDays(10), closesAt: inDays(40), timezone: 'Europe/Lisbon', description: 'Hello' }), params(id)));
  expect(general.status, JSON.stringify(general.body)).toBe(200);
  version = general.body.call.configVersion;
  const form = await read(await formPut(json('PUT', { baseVersion: version, fields: FIELDS }), params(id)));
  expect(form.status, JSON.stringify(form.body)).toBe(200);
  return form.body.call.configVersion as number;
}
const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => read(await actionPost(json('POST', { action, ...extra }), params(id)));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  process.env.CALLS_MODE = 'on';
  delete process.env.CALLS_TEST_EMAILS;
  db = callsDb();
  incubatorMember = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' }, { id: OTHER_FIRM, name: 'zz-test-other' });
  db.tables.incubators.push({ id: ORG, name: 'zz-test-hub' });
  member('ana', FIRM, 'admin');
  member('bob', FIRM, 'member');
  member('otto', OTHER_FIRM, 'admin');
  currentUser = null;
});

describe('the switch', () => {
  it('off (the default): every route answers 404, for a member and for a stranger alike', async () => {
    delete process.env.CALLS_MODE;
    as('ana');
    for (const res of [await listGet(new NextRequest('http://localhost/api/calls')), await accessGet(), await createPost(json('POST', { kind: 'catalog_entity' })),
      await oneGet(json('GET'), params('x')), await publicGet(json('GET'), { params: { token: 'abcdefghijklmnopqrstuv' } })]) {
      expect(res.status).toBe(404);
    }
    expect(db.tables.calls).toHaveLength(0);
  });

  it('allowlist: only the listed emails get in, everyone else gets the same 404', async () => {
    process.env.CALLS_MODE = 'allowlist';
    process.env.CALLS_TEST_EMAILS = 'ana@example.com';
    as('ana');
    expect((await accessGet()).status).toBe(200);
    as('bob');
    expect((await accessGet()).status).toBe(404);
  });

  it('signed out is 401 when the switch is on, and nothing leaks', async () => {
    currentUser = null;
    expect((await accessGet()).status).toBe(401);
  });
});

describe('who gets the tab, who may create', () => {
  it('a member of an investor firm gets it, flagged as manager or not; a stranger is refused', async () => {
    as('ana');
    expect((await read(await accessGet())).body.promoters).toEqual([{ kind: 'catalog_entity', id: FIRM, name: 'zz-test-firm', canManage: true }]);
    as('bob');
    expect((await read(await accessGet())).body.promoters[0].canManage).toBe(false);
    db.users.set('zed', { id: 'zed', email: 'zed@example.com' });
    as('zed');
    expect((await accessGet()).status).toBe(403);
  });

  it('an ecosystem organisation member gets it too (owner/manager manage)', async () => {
    db.users.set('ivy', { id: 'ivy', email: 'ivy@example.com' });
    incubatorMember = { id: 'im1', incubatorId: ORG, role: 'manager', incubatorName: 'zz-test-hub' };
    as('ivy');
    expect((await read(await accessGet())).body.promoters).toEqual([{ kind: 'incubator', id: ORG, name: 'zz-test-hub', canManage: true }]);
    const created = await read(await createPost(json('POST', { kind: 'incubator', name: 'Hub call' })));
    expect(created.status).toBe(200);
    expect(db.tables.calls[0]).toMatchObject({ promoter_kind: 'incubator', incubator_id: ORG, catalog_entity_id: null });
  });

  it('only owners/admins create; a plain member can look but not create', async () => {
    as('bob');
    expect((await createPost(json('POST', { kind: 'catalog_entity', name: 'x' }))).status).toBe(403);
    expect(db.tables.calls).toHaveLength(0);
    expect((await read(await listGet(new NextRequest('http://localhost/api/calls')))).body.promoter.canManage).toBe(false);
  });

  it('a new call is a draft with one phase, and an event', async () => {
    const call = await newCall();
    expect(db.tables.calls[0]).toMatchObject({ status: 'draft', config_version: 1, created_by: 'ana', catalog_entity_id: FIRM });
    expect(db.tables.call_phases).toMatchObject([{ call_id: call.id, position: 0, name: 'Phase 1' }]);
    expect(db.tables.call_events.map((e) => e.event)).toEqual(['call_created']);
  });

  it('the list shows only the caller\'s own calls, with their counts', async () => {
    await newCall('ana', 'Mine');
    await newCall('otto', 'Theirs');
    as('ana');
    const { body } = await read(await listGet(new NextRequest('http://localhost/api/calls')));
    expect(body.calls.map((c: { name: string }) => c.name)).toEqual(['Mine']);
    expect(body.calls[0]).toMatchObject({ applications: 0, phases: 1, fields: 0, effectiveStatus: 'draft' });
  });

  it('an unnamed call gets a placeholder name; a blank one is not stored blank', async () => {
    as('ana');
    await createPost(json('POST', { kind: 'catalog_entity', name: '   ' }));
    expect(db.tables.calls[0].name).toBe('Untitled call');
  });
});

describe('isolation between entities', () => {
  it('another entity\'s call is a 404 on every route — its existence is not revealed', async () => {
    const theirs = await newCall('otto', 'Theirs');
    as('ana');
    for (const res of [await oneGet(json('GET'), params(theirs.id)), await onePatch(json('PATCH', { baseVersion: 1, name: 'x' }), params(theirs.id)),
      await phasesPut(json('PUT', { baseVersion: 1, phases: [{ name: 'x' }] }), params(theirs.id)), await formPut(json('PUT', { baseVersion: 1, fields: [] }), params(theirs.id)),
      await duplicatePost(json('POST'), params(theirs.id)), await actionPost(json('POST', { action: 'confirm' }), params(theirs.id))]) {
      expect(res.status).toBe(404);
    }
    expect(db.tables.calls.find((c) => c.id === theirs.id)).toMatchObject({ name: 'Theirs', config_version: 1, status: 'draft' });
  });

  it('a plain member can open the editor data but every write is refused', async () => {
    const call = await newCall('ana');
    as('bob');
    expect((await oneGet(json('GET'), params(call.id))).status).toBe(200);
    expect((await onePatch(json('PATCH', { baseVersion: 1, name: 'hack' }), params(call.id))).status).toBe(403);
    expect((await formPut(json('PUT', { baseVersion: 1, fields: [] }), params(call.id))).status).toBe(403);
    expect((await actionPost(json('POST', { action: 'confirm' }), params(call.id))).status).toBe(403);
    expect((await duplicatePost(json('POST'), params(call.id))).status).toBe(403);
    expect(db.tables.calls[0].name).toBe('Seed Call');
  });
});

describe('autosave: General, Phases, Form', () => {
  it('General saves, converts nothing it should not, bumps the version', async () => {
    const call = await newCall();
    const res = await read(await onePatch(json('PATCH', { baseVersion: 1, name: '  Seed Call 2027  ', timezone: 'America/New_York', visibility: 'unlisted', limitUnit: 'legal_entity', allowMultiple: true, contentLanguage: 'pt', currency: 'USD' }), params(call.id)));
    expect(res.status).toBe(200);
    expect(res.body.call).toMatchObject({ name: 'Seed Call 2027', timezone: 'America/New_York', visibility: 'unlisted', limitUnit: 'legal_entity', allowMultiple: true, contentLanguage: 'pt', currency: 'USD', configVersion: 2 });
  });

  it('rejects bad input without changing anything', async () => {
    const call = await newCall();
    for (const body of [{ name: '' }, { timezone: 'Mars/Phobos' }, { visibility: 'secret' }, { currency: 'XXX' }, { contentLanguage: 'tlh' }, { opensAt: 'garbage' },
      { opensAt: inDays(5), closesAt: inDays(2) }]) {
      const res = await onePatch(json('PATCH', { baseVersion: 1, ...body }), params(call.id));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.tables.calls[0]).toMatchObject({ name: 'Seed Call', config_version: 1, currency: 'EUR' });
  });

  it('the status, the link and the owner can never be set from the client', async () => {
    const call = await newCall();
    await onePatch(json('PATCH', { baseVersion: 1, name: 'ok', status: 'open', linkToken: 'evil', createdBy: 'mallory', promoterId: OTHER_FIRM }), params(call.id));
    expect(db.tables.calls[0]).toMatchObject({ status: 'draft', link_token: null, created_by: 'ana', catalog_entity_id: FIRM });
  });

  it('a second editor with a stale version gets a conflict and writes nothing', async () => {
    const call = await newCall();
    expect((await onePatch(json('PATCH', { baseVersion: 1, name: 'First' }), params(call.id))).status).toBe(200);
    const stale = await read(await onePatch(json('PATCH', { baseVersion: 1, name: 'Second' }), params(call.id)));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('conflict');
    expect(db.tables.calls[0].name).toBe('First');
    expect((await formPut(json('PUT', { baseVersion: 1, fields: FIELDS }), params(call.id))).status).toBe(409);
    expect(db.tables.call_form_fields).toHaveLength(0);
  });

  it('phases: replaced as an ordered list, at least one, dates sane, renamed by id', async () => {
    const call = await newCall();
    let res = await read(await phasesPut(json('PUT', { baseVersion: 1, phases: [{ name: 'Documents' }, { name: 'Pitch', startsOn: '2026-11-01', endsOn: '2026-11-15' }, { name: '' }] }), params(call.id)));
    expect(res.status).toBe(200);
    expect(res.body.phases.map((p: { name: string }) => p.name)).toEqual(['Documents', 'Pitch', 'Phase 3']);
    const keepId = res.body.phases[1].id;
    res = await read(await phasesPut(json('PUT', { baseVersion: res.body.call.configVersion, phases: [{ id: keepId, name: 'Pitch day' }, { name: 'Decision' }] }), params(call.id)));
    expect(res.body.phases.map((p: { name: string }) => p.name)).toEqual(['Pitch day', 'Decision']);
    expect(res.body.phases[0].id).toBe(keepId);
    expect((await phasesPut(json('PUT', { baseVersion: res.body.call.configVersion, phases: [] }), params(call.id))).status).toBe(400);
    expect((await phasesPut(json('PUT', { baseVersion: res.body.call.configVersion, phases: [{ name: 'x', startsOn: '2026-12-01', endsOn: '2026-11-01' }] }), params(call.id))).status).toBe(400);
  });

  it('form: stable ids and option ids survive saves; fields removed from the list are removed', async () => {
    const call = await newCall();
    const fields: Record<string, unknown>[] = [{ id: 'sel-0000-0001', kind: 'single_choice', label: 'Stage', options: [{ id: 'opt-seed-001', label: 'Seed' }, { id: 'opt-ser-a-01', label: 'Series A' }] }, FIELDS[0]];
    let res = await read(await formPut(json('PUT', { baseVersion: 1, fields }), params(call.id)));
    expect(res.status).toBe(200);
    // rename an option: the id stays
    const renamed = [{ ...fields[0], options: [{ id: 'opt-seed-001', label: 'Pre-seed / Seed' }, (fields[0].options as Record<string, unknown>[])[1]] }, FIELDS[0]];
    res = await read(await formPut(json('PUT', { baseVersion: res.body.call.configVersion, fields: renamed }), params(call.id)));
    expect(res.body.fields[0].options.map((o: { id: string }) => o.id)).toEqual(['opt-seed-001', 'opt-ser-a-01']);
    expect(res.body.fields[0].options[0].label).toBe('Pre-seed / Seed');
    res = await read(await formPut(json('PUT', { baseVersion: res.body.call.configVersion, fields: [FIELDS[0]] }), params(call.id)));
    expect(db.tables.call_form_fields.map((f) => f.id)).toEqual(['inc-0000-0001']);
  });

  it('form: the server refuses what the editor must never send', async () => {
    const call = await newCall();
    const bad = async (fields: unknown) => (await formPut(json('PUT', { baseVersion: 1, fields }), params(call.id))).status;
    expect(await bad([{ kind: 'photo', label: 'x' }])).toBe(400);
    expect(await bad([{ ...FIELDS[1], position: 0 }, { ...FIELDS[0], position: 1 }])).toBe(400); // condition before its controller
    expect(await bad([FIELDS[0], { ...FIELDS[1], condition: { fieldId: 'inc-0000-0001', operator: 'equals', value: 'maybe' } }])).toBe(400);
    expect(await bad([{ kind: 'number', label: 'x', platformMapping: 'company_name' }])).toBe(400);
    expect(db.tables.call_form_fields).toHaveLength(0);
    expect(db.tables.calls[0].config_version).toBe(1);
  });

  it('GET returns what is missing, tab by tab, and what the buttons may do', async () => {
    const call = await newCall();
    const { body } = await read(await oneGet(json('GET'), params(call.id)));
    expect(body.issues.map((i: { tab: string }) => i.tab)).toEqual(['general', 'general', 'form']);
    expect(body.actions).toMatchObject({ canEditForm: true, canConfirm: false, canPublish: false });
    expect(body.summary).toMatchObject({ phases: 1, fields: 0 });
  });
});

describe('the life of a call', () => {
  it('cannot be confirmed while something is missing — and the refusal says what', async () => {
    const call = await newCall();
    const res = await act(call.id, 'confirm');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Not ready yet');
    expect(db.tables.calls[0].status).toBe('draft');
    expect(db.tables.call_config_snapshots).toHaveLength(0);
  });

  it('confirm -> locked -> edit configuration -> confirm again; each confirmation is kept', async () => {
    const call = await newCall();
    await readyCall(call.id);
    const confirmed = await act(call.id, 'confirm');
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.call).toMatchObject({ status: 'validated', validatedAt: expect.any(String) });
    expect(confirmed.body.actions).toMatchObject({ canEditForm: false, canEditConfiguration: true, canPublish: true });
    expect(db.tables.call_config_snapshots).toHaveLength(1);
    expect(db.tables.call_config_snapshots[0].snapshot).toMatchObject({ call: { name: 'Seed Call' }, fields: expect.any(Array), phases: expect.any(Array) });

    // locked
    const version = confirmed.body.call.configVersion;
    for (const res of [await onePatch(json('PATCH', { baseVersion: version, name: 'sneaky' }), params(call.id)),
      await formPut(json('PUT', { baseVersion: version, fields: [] }), params(call.id)), await phasesPut(json('PUT', { baseVersion: version, phases: [{ name: 'x' }] }), params(call.id))]) {
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('locked');
    }
    expect(db.tables.call_form_fields).toHaveLength(3);

    // edit configuration invalidates the confirmation
    const edited = await act(call.id, 'edit');
    expect(edited.body.call).toMatchObject({ status: 'draft', validatedAt: null });
    expect((await onePatch(json('PATCH', { baseVersion: version, name: 'now allowed' }), params(call.id))).status).toBe(200);
    expect((await act(call.id, 'confirm')).status).toBe(200);
    expect(db.tables.call_config_snapshots).toHaveLength(2);
    expect(db.tables.call_events.map((e) => e.event)).toEqual(expect.arrayContaining(['call_created', 'call_confirmed', 'call_unconfirmed']));
  });

  it('publishing needs the confirmation; a future opening is Scheduled and gets a link', async () => {
    const call = await newCall();
    await readyCall(call.id);
    expect((await act(call.id, 'publish')).status).toBe(409); // not confirmed yet
    await act(call.id, 'confirm');
    const published = await act(call.id, 'publish');
    expect(published.status).toBe(200);
    expect(published.body.call).toMatchObject({ status: 'scheduled', publishedAt: expect.any(String) });
    expect(published.body.call.linkToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await act(call.id, 'publish')).status).toBe(409); // already published
  });

  it('a scheduled call opens by itself when its time comes — and only because it was confirmed and published', async () => {
    const call = await newCall();
    await readyCall(call.id);
    await act(call.id, 'confirm');
    await act(call.id, 'publish');
    // time passes: the opening is now in the past
    const row = db.tables.calls[0];
    row.opens_at = inDays(-1);
    const { body } = await read(await oneGet(json('GET'), params(call.id)));
    expect(body.effectiveStatus).toBe('open');
    expect(body.call.status).toBe('open');
    expect(db.tables.call_events.some((e) => e.event === 'call_opened' && e.actor_user_id === null)).toBe(true);

    // a confirmed-but-unpublished call never opens, whatever the clock says
    const other = await newCall('ana', 'Never published');
    await readyCall(other.id);
    await act(other.id, 'confirm');
    db.tables.calls.find((c) => c.id === other.id)!.opens_at = inDays(-1);
    expect((await read(await oneGet(json('GET'), params(other.id)))).body.call.status).toBe('validated');
  });

  it('once open: the form is locked for good; the deadline can be extended and the call closed early', async () => {
    const call = await newCall();
    const version = await readyCall(call.id);
    await act(call.id, 'confirm');
    await act(call.id, 'publish');
    db.tables.calls[0].opens_at = inDays(-1);
    await oneGet(json('GET'), params(call.id)); // opens
    expect((await act(call.id, 'edit')).status).toBe(409); // "Edit configuration" is gone once open
    expect((await formPut(json('PUT', { baseVersion: version + 5, fields: [] }), params(call.id))).status).toBe(409);
    expect(db.tables.call_form_fields).toHaveLength(3);

    const earlier = await act(call.id, 'extend', { closesAt: inDays(20) });
    expect(earlier.status).toBe(409); // must be later than the current deadline (40 days)
    const later = await act(call.id, 'extend', { closesAt: inDays(55) });
    expect(later.status).toBe(200);
    expect(Date.parse(later.body.call.closesAt)).toBeGreaterThan(Date.now() + 50 * DAY);
    expect(db.tables.call_events.map((e) => e.event)).toContain('deadline_extended');

    const closed = await act(call.id, 'close');
    expect(closed.body.call).toMatchObject({ status: 'closed', closedAt: expect.any(String) });
    expect((await act(call.id, 'close')).status).toBe(409);
    expect((await act(call.id, 'extend', { closesAt: inDays(90) })).status).toBe(409);
  });

  it('two clicks on Confirm cannot both succeed (compare-and-swap on the status)', async () => {
    const call = await newCall();
    await readyCall(call.id);
    const [a, b] = await Promise.all([act(call.id, 'confirm'), act(call.id, 'confirm')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.tables.call_config_snapshots).toHaveLength(1);
  });

  it('unknown actions are refused', async () => {
    const call = await newCall();
    expect((await act(call.id, 'explode')).status).toBe(400);
  });
});

describe('duplicating a call', () => {
  it('copies the configuration, phases and form with fresh ids and remapped conditions — no dates, no link, no applications', async () => {
    const call = await newCall();
    await readyCall(call.id);
    await act(call.id, 'confirm');
    await act(call.id, 'publish');
    db.tables.call_applications.push({ id: 'app-1', call_id: call.id, applicant_user_id: 'u9', status: 'submitted', draft_answers: {} });
    as('ana');
    const copy = await read(await duplicatePost(json('POST'), params(call.id)));
    expect(copy.status).toBe(200);
    const row = db.tables.calls.find((c) => c.id === copy.body.call.id)!;
    expect(row).toMatchObject({ name: 'Seed Call (copy)', status: 'draft', link_token: null, opens_at: null, closes_at: null, duplicated_from: call.id, catalog_entity_id: FIRM });
    const fields = db.tables.call_form_fields.filter((f) => f.call_id === row.id);
    expect(fields).toHaveLength(3);
    const original = db.tables.call_form_fields.filter((f) => f.call_id === call.id);
    expect(fields.every((f) => !original.some((o) => o.id === f.id))).toBe(true);
    const dep = fields.find((f) => f.kind === 'date')!;
    expect((dep.condition as { fieldId: string }).fieldId).toBe(fields.find((f) => f.kind === 'yes_no')!.id); // remapped to the COPY's own field
    expect(db.tables.call_applications.filter((a) => a.call_id === row.id)).toHaveLength(0);
    expect(db.tables.call_phases.filter((p) => p.call_id === row.id)).toHaveLength(1);
    // the source is untouched
    expect(db.tables.calls.find((c) => c.id === call.id)!.status).toBe('scheduled');
  });
});

describe('the public link', () => {
  async function published() {
    const call = await newCall();
    await readyCall(call.id);
    await act(call.id, 'confirm');
    const res = await act(call.id, 'publish');
    return { call, token: res.body.call.linkToken as string };
  }
  const pub = async (token: string) => read(await publicGet(json('GET'), { params: { token } }));

  it('shows the header and "Applications open on [date]" — and no ids, no form, no draft', async () => {
    const { token } = await published();
    currentUser = null; // a candidate: no account
    const { status, body } = await pub(token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, name: 'Seed Call', promoter: 'zz-test-firm', status: 'scheduled' });
    expect(body.message).toMatch(/^Applications open on \d{2} \w{3} \d{4}\.$/);
    expect(JSON.stringify(body)).not.toMatch(/call_id|fields|created_by|linkToken/);
  });

  it('says it is open once it opens, and closed once it closes', async () => {
    const { call, token } = await published();
    db.tables.calls[0].opens_at = inDays(-1);
    expect((await pub(token)).body).toMatchObject({ status: 'open', message: 'Applications are open.' });
    db.tables.calls[0].closes_at = inDays(-0.5);
    db.tables.calls[0].opens_at = inDays(-2);
    expect((await pub(token)).body).toMatchObject({ status: 'closed', message: 'This call is closed.' });
    expect(call.id).toBeTruthy();
  });

  it('a call taken back to draft keeps its link but stops being advertised; unknown or malformed tokens are 404', async () => {
    const { call, token } = await published();
    as('ana');
    await act(call.id, 'edit');
    expect((await pub(token)).status).toBe(404);
    expect((await pub('x'.repeat(22))).status).toBe(404);
    expect((await pub('short')).status).toBe(404);
    expect((await pub('x'.repeat(200))).status).toBe(404);
  });

  it('with the switch off the link answers 404 as well', async () => {
    const { token } = await published();
    delete process.env.CALLS_MODE;
    expect((await pub(token)).status).toBe(404);
  });
});
