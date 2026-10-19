// Prompt 917, I1 — the entity's side of the new kinds, through the real handlers: the editor saves them with their configuration (and the server refuses what is
// not valid), a duplicated call and a form imported from another call carry them, and the readiness check holds a group's own questions to the same standard.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let currentUser: { id: string; email: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }) }));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as oneGet, PATCH as onePatch } from './[id]/route';
import { PUT as formPut } from './[id]/form/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { POST as actionPost } from './[id]/action/route';
import { newField } from '@/lib/calls/form-builder';
import { defaultGroupConfig } from '@/lib/calls/field-config';
import { importForm } from '@/lib/calls/form-import';
import { readiness } from '@/lib/calls/lifecycle';
import { rowToCall, rowToField } from '@/lib/calls/mappers';
import { previewPages, testStep, validationHints } from '@/lib/calls/preview-logic';
import type { FormField } from '@/lib/calls/types';

const FIRM = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (id: string) => { currentUser = { id, email: `${id}@example.com` }; };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  process.env.CALLS_MODE = 'on';
  db = callsDb(); db.clock = Date.now();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  db.users.set('ana', { id: 'ana', email: 'ana@example.com' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  currentUser = null;
});

async function newCall() {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Seed Call' })));
  expect(created.status).toBe(200);
  return created.body.call as { id: string; configVersion: number };
}
const version = async (id: string) => (await read(await oneGet(json('GET'), params(id)))).body.call.configVersion as number;
const fld = (kind: FormField['kind'], over: Partial<FormField> = {}): FormField => ({ ...newField(kind, 1, 0), ...over });

const FIELDS = (): FormField[] => {
  const team = fld('group', { id: 'team-group-0001', label: 'Team', position: 2, required: true });
  team.validations = { group: {
    entryLabel: 'Team member', min: 1, max: 6, display: 'cards', presetRows: [],
    subFields: [
      { id: '10000000-0000-4000-8000-000000000001', kind: 'short_text', label: 'Name', required: true, options: [], validations: {} },
      { id: '10000000-0000-4000-8000-000000000002', kind: 'email', label: 'Email', required: true, options: [], validations: {} },
      { id: '10000000-0000-4000-8000-000000000003', kind: 'file', label: 'CV', required: false, options: [], validations: { maxFileMb: 5, fileFormats: ['pdf', 'word'] } },
    ],
  } };
  const table = fld('group', { id: 'compet-group-001', label: 'Competitor analysis', position: 3 });
  table.validations = { group: { entryLabel: 'Row', min: 3, max: 3, display: 'table', presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']],
    subFields: [{ id: '20000000-0000-4000-8000-000000000001', kind: 'short_text', label: 'Company', required: false, options: [], validations: {} }, { id: '20000000-0000-4000-8000-000000000002', kind: 'long_text', label: 'Strengths', required: false, options: [], validations: {} }] } };
  return [
    fld('url', { id: 'video-link-0001', label: 'Pitch video', position: 0, validations: { urlHint: 'video' } }),
    fld('file', { id: 'others-file-001', label: 'Other documents', position: 1, validations: { maxFiles: 5, fileFormats: ['pdf', 'word', 'excel'], maxFileMb: 8 } }),
    team, table,
  ];
};

describe('the editor saves the new kinds', () => {
  it('with their whole configuration, and returns it as saved', async () => {
    const call = await newCall();
    const saved = await read(await formPut(json('PUT', { baseVersion: await version(call.id), fields: FIELDS() }), params(call.id)));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const rows = db.tables.call_form_fields.filter((f) => f.call_id === call.id);
    expect(rows.map((r) => r.kind)).toEqual(['url', 'file', 'group', 'group']);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label as string, r]));
    expect(byLabel['Pitch video'].validations).toEqual({ urlHint: 'video' });
    expect(byLabel['Other documents'].validations).toEqual({ maxFileMb: 8, fileFormats: ['pdf', 'word', 'excel'], maxFiles: 5 });
    expect((byLabel.Team.validations as { group: { subFields: { kind: string }[]; min: number; max: number } }).group).toMatchObject({ min: 1, max: 6 });
    expect((byLabel.Team.validations as { group: { subFields: { kind: string }[] } }).group.subFields.map((s) => s.kind)).toEqual(['short_text', 'email', 'file']);
    const again = rowToField(byLabel['Competitor analysis']);
    expect(again.validations.group).toMatchObject({ display: 'table', min: 3, max: 3, presetRows: [['Your company'], ['Competitor 1'], ['Competitor 2']] });
    // the state the editor reloads has them too
    const state = await read(await oneGet(json('GET'), params(call.id)));
    expect(state.body.fields.map((f: { kind: string }) => f.kind)).toEqual(['url', 'file', 'group', 'group']);
  });

  it('refuses what is not valid: a group inside a group, a group with no question, a minimum above the maximum, an unknown kind', async () => {
    const call = await newCall();
    const put = async (fields: unknown[]) => read(await formPut(json('PUT', { baseVersion: await version(call.id), fields }), params(call.id)));
    const bad = (mut: (g: FormField) => void) => { const [, , team] = FIELDS(); mut(team); return [team]; };
    expect((await put(bad((g) => { g.validations.group!.subFields.push({ id: '30000000-0000-4000-8000-000000000001', kind: 'group' as never, label: 'inner', required: false, options: [], validations: {} }); }))).status).toBe(400);
    expect((await put(bad((g) => { g.validations.group!.subFields = []; }))).status).toBe(400);
    expect((await put(bad((g) => { g.validations.group!.min = 9; g.validations.group!.max = 2; }))).status).toBe(400);
    expect((await put([{ ...fld('short_text'), kind: 'video' }])).status).toBe(400);
    expect(db.tables.call_form_fields.filter((f) => f.call_id === call.id)).toHaveLength(0);
  });
});

describe('a duplicated call and an imported form carry the new kinds', () => {
  it('duplicating copies the configuration of a link, of a File with several formats, and of every group — with fresh ids', async () => {
    const call = await newCall();
    await formPut(json('PUT', { baseVersion: await version(call.id), fields: FIELDS() }), params(call.id));
    const copy = await read(await duplicatePost(json('POST'), params(call.id)));
    expect(copy.status).toBe(200);
    const original = db.tables.call_form_fields.filter((f) => f.call_id === call.id);
    const copied = db.tables.call_form_fields.filter((f) => f.call_id === copy.body.call.id);
    expect(copied.map((f) => f.kind)).toEqual(original.map((f) => f.kind));
    expect(copied.map((f) => f.validations)).toEqual(original.map((f) => f.validations));
    expect(copied.every((f) => !original.some((o) => o.id === f.id))).toBe(true);
  });

  it('importing the form of another call copies them too — as copies', () => {
    const source = FIELDS().map((f, i) => ({ ...f, page: 1, position: i }));
    const r = importForm([], source, 'replace', (() => { let n = 0; return () => `imported-id-${++n}00000`; })());
    expect(r.fields.map((f) => f.kind)).toEqual(['url', 'file', 'group', 'group']);
    expect(r.fields[2].validations.group?.subFields).toHaveLength(3);
    r.fields[2].validations.group!.entryLabel = 'CHANGED';
    expect(source[2].validations.group!.entryLabel).toBe('Team member');
  });
});

describe('what is missing before the call can be confirmed', () => {
  const call = () => rowToCall({ id: 'c1', promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, name: 'X', status: 'draft', opens_at: inDays(5), closes_at: inDays(30), timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', config_version: 1, created_by: 'u', created_at: '', updated_at: '' });
  it('holds a group\'s own questions to the same standard: text, and two options for a choice', () => {
    const g = fld('group', { label: 'Team' });
    g.validations = { group: { ...defaultGroupConfig(), subFields: [
      { id: '10000000-0000-4000-8000-000000000001', kind: 'short_text', label: 'Untitled question', required: false, options: [], validations: {} },
      { id: '10000000-0000-4000-8000-000000000002', kind: 'single_choice', label: 'Role', required: false, options: [{ id: 'opt_aaaaaaaa', label: 'CEO' }], validations: {} },
    ] } };
    const issues = readiness(call(), [{ id: 'p', position: 0, name: 'Apply', startsOn: null, endsOn: null }], [g]).map((i) => i.message);
    expect(issues).toContain('A question in the group “Team” still has no text.');
    expect(issues).toContain('“Role” (in “Team”) needs at least two options.');
    expect(readiness(call(), [{ id: 'p', position: 0, name: 'Apply', startsOn: null, endsOn: null }], [fld('group', { label: 'Team' })]).some((i) => i.message.includes('group'))).toBe(false);
  });

  it('a call with the new kinds can still be validated and published', async () => {
    const created = await newCall();
    const general = await read(await onePatch(json('PATCH', { baseVersion: created.configVersion, opensAt: inDays(10), closesAt: inDays(40), timezone: 'Europe/Lisbon', description: 'Hello' }), params(created.id)));
    expect(general.status).toBe(200);
    const phases = db.tables.call_phases; phases.push({ id: 'ph1', call_id: created.id, position: 0, name: 'Apply', starts_on: null, ends_on: null });
    const form = await read(await formPut(json('PUT', { baseVersion: general.body.call.configVersion, fields: FIELDS() }), params(created.id)));
    expect(form.status).toBe(200);
    expect((await read(await actionPost(json('POST', { action: 'confirm' }), params(created.id)))).status).toBe(200);
  });
});

describe('the preview and the test mode', () => {
  const fields = FIELDS();
  it('say what each new kind asks of the applicant', () => {
    const hints = Object.fromEntries(fields.map((f) => [f.label, validationHints(f).join(' · ')]));
    expect(hints['Pitch video']).toContain('http://');
    expect(hints['Pitch video']).toContain('video');
    expect(hints['Other documents']).toBe('PDF, Word or Excel only, max 8 MB each, up to 5 files');
    expect(hints.Team).toContain('1 to 6 team member entries');
    expect(hints['Competitor analysis']).toContain('3 fixed rows');
    expect(hints['Competitor analysis']).toContain('table');
    expect(validationHints(fld('email')).join()).toContain('email');
  });
  it('shows every page in the preview, and in test mode blocks "Next" until a required group is filled in — naming what is missing', () => {
    expect(previewPages(fields, false, {}).flatMap((p) => p.fields.map((f) => f.label))).toEqual(['Pitch video', 'Other documents', 'Team', 'Competitor analysis']);
    const step = testStep(fields, {}, 0);
    expect(step.kind).toBe('blocked');
    if (step.kind === 'blocked') expect(step.errors['team-group-0001']).toBe('Add at least one team member.');
  });
});
