// Prompt 909, I3 — the team of a call through the real handlers and the real access rules, over the stateful fake
// database: the starting category, who may do what (decided by the permissions of THIS call, not by the role), the
// organisation's categories, only active members with a seat, the rule that a call always has an administrator,
// the owner who is never locked out, the team edited while the call is locked, conflicts and duplication.
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

import { GET as listGet, POST as createPost } from './route';
import { GET as teamGet, POST as teamPostRaw } from './[id]/team/route';
import { PATCH as generalPatch } from './[id]/route';
import { POST as actionPost } from './[id]/action/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { NO_ADMINISTRATOR } from '@/lib/calls/team-rules';
import { NO_SEAT_REASON } from '@/lib/calls/team-store';
import { ALL_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const json = (method: string, body?: unknown, url = 'http://localhost/api/calls') => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (userId: string) => { currentUser = { id: userId, email: `${userId}@example.com` }; };
function member(userId: string, role: string, entity = FIRM, name: string | null = null) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  const id = `m-${userId}-${entity.slice(0, 2)}`;
  db.tables.matchdeal_investor_members.push({ id, user_id: userId, catalog_entity_id: entity, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
  if (name) db.tables.matchdeal_profiles.push({ membership_id: id, kind: 'investor', representative_name: name });
}
async function newCall(name = 'Seed Call', user = 'ana') {
  as(user);
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  expect(created.status).toBe(200);
  return created.body.call as { id: string; configVersion: number };
}
const team = (id: string, user?: string) => { if (user) as(user); return teamGet(json('GET'), params(id)).then(read); };
const post = (id: string, body: Record<string, unknown>, user?: string) => { if (user) as(user); return teamPostRaw(json('POST', body), params(id)).then(read); };
const categoryId = (name: string) => db.tables.call_team_categories.find((c) => c.name === name)!.id as string;
const membersOf = (callId: string) => db.tables.call_team_members.filter((m) => m.call_id === callId);
const events = (callId: string, event: string) => db.tables.call_events.filter((e) => e.call_id === callId && e.event === event);
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' }, { id: OTHER, name: 'zz-test-other' });
  member('ana', 'admin', FIRM, 'Ana Silva'); member('carl', 'admin'); member('bob', 'member', FIRM, 'Bob Builder'); member('dora', 'member');
  member('olga', 'owner'); member('otto', 'admin', OTHER);
  currentUser = null;
});

describe('the starting point', () => {
  it('a new call creates the organisation\'s "Administrator" category (every permission) and puts its creator in it', async () => {
    const { id } = await newCall();
    expect(db.tables.call_team_categories).toMatchObject([{ name: 'Administrator', catalog_entity_id: FIRM }]);
    expect(Object.values(db.tables.call_team_categories[0].permissions as Record<string, boolean>).every(Boolean)).toBe(true);
    expect(Object.keys(db.tables.call_team_categories[0].permissions as object)).toHaveLength(9);
    expect(membersOf(id)).toMatchObject([{ user_id: 'ana', category_id: categoryId('Administrator') }]);
  });
  it('the second call reuses the category: the organisation has one, not one per call', async () => {
    await newCall('One'); const two = await newCall('Two', 'carl');
    expect(db.tables.call_team_categories).toHaveLength(1);
    expect(membersOf(two.id)).toMatchObject([{ user_id: 'carl' }]);
  });
  it('a call from before the team existed gets its team when someone who could manage it by role opens it, and keeps working for them', async () => {
    db.tables.calls.push({ id: 'legacy-1', promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, name: 'Legacy', created_by: 'ana', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:00:00Z', config_version: 1, status: 'draft', timezone: 'Europe/Lisbon' });
    as('carl');
    const res = await read(await generalPatch(json('PATCH', { baseVersion: 1, description: 'x' }), params('legacy-1')));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(membersOf('legacy-1').map((m) => m.user_id).sort()).toEqual(['ana', 'carl']);
    // a plain member opening a legacy call gets nothing
    db.tables.calls.push({ id: 'legacy-2', promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, name: 'Legacy 2', created_by: 'ana', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:00:00Z', config_version: 1, status: 'draft', timezone: 'Europe/Lisbon' });
    as('bob');
    expect((await read(await generalPatch(json('PATCH', { baseVersion: 1, description: 'x' }), params('legacy-2')))).status).toBe(403);
    expect(membersOf('legacy-2')).toEqual([]);
  });
});

describe('the permissions decide, on the server', () => {
  async function callWith(...adds: [string, string][]) {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator', permissions: { evaluate_assigned: true } }, 'ana');
    await post(id, { action: 'create_category', name: 'Manager', permissions: { configure_call: true } }, 'ana');
    for (const [user, cat] of adds) expect((await post(id, { action: 'add_member', userId: user, categoryId: categoryId(cat) }, 'ana')).status, user).toBe(200);
    return id;
  }
  const patch = (id: string, user: string) => { as(user); return generalPatch(json('PATCH', { baseVersion: row(id).config_version, description: 'changed' }), params(id)).then(read); };

  it('"Configure call" edits, confirms, publishes, deletes and archives; without it a member is refused with the reason', async () => {
    const id = await callWith(['bob', 'Evaluator'], ['dora', 'Manager']);
    const refused = await patch(id, 'bob');
    expect(refused).toMatchObject({ status: 403 });
    expect(refused.body.error).toBe('You do not have the “Configure call” permission on this call.');
    as('bob');
    for (const action of ['confirm', 'delete', 'archive']) expect((await actionPost(json('POST', { action }), params(id)).then(read)).status, action).toBe(403);
    expect((await patch(id, 'dora')).status).toBe(200); // Manager: configure_call
    expect(row(id).description).toBe('changed');
  });

  it('"Manage team & permissions" edits the team; configuring alone is not enough', async () => {
    const id = await callWith(['dora', 'Manager']);
    const refused = await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Evaluator') }, 'dora');
    expect(refused).toMatchObject({ status: 403, body: { error: 'You do not have the “Manage team & permissions” permission on this call.' } });
    expect(membersOf(id).map((m) => m.user_id)).not.toContain('bob');
  });

  it('a role is no longer enough: an organisation admin who is not in the team is refused once the call has a team', async () => {
    const { id } = await newCall();           // team: ana
    expect((await patch(id, 'carl')).status).toBe(403);   // carl is an admin by role, but not in this call's team
    expect(membersOf(id).map((m) => m.user_id)).toEqual(['ana']);
  });

  it('the owner of the organisation always has everything, even outside the team', async () => {
    const { id } = await newCall();
    expect((await patch(id, 'olga')).status).toBe(200);
    expect((await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Administrator') }, 'olga')).status).toBe(200);
    expect((await team(id, 'olga')).body.canManageTeam).toBe(true);
  });

  it('an individual adjustment can take away, or give, a permission to one person only', async () => {
    const id = await callWith(['dora', 'Manager'], ['bob', 'Manager']);
    await post(id, { action: 'set_overrides', userId: 'dora', overrides: { configure_call: false } }, 'ana');
    expect((await patch(id, 'dora')).status).toBe(403);   // adjusted off for dora only
    expect((await patch(id, 'bob')).status).toBe(200);    // same category, untouched
    await post(id, { action: 'set_overrides', userId: 'dora', overrides: { configure_call: true } }, 'ana');
    expect((await patch(id, 'dora')).status).toBe(200);
  });

  it('a stranger and a signed-out caller see nothing', async () => {
    const { id } = await newCall();
    expect((await team(id, 'otto')).status).toBe(404);
    currentUser = null;
    expect((await team(id)).status).toBe(401);
  });

  it('anyone of the organisation may LOOK at the team; only managers see the controls (canManageTeam)', async () => {
    const { id } = await newCall();
    expect((await team(id, 'bob')).body).toMatchObject({ ok: true, canManageTeam: false });
    expect((await team(id, 'ana')).body.canManageTeam).toBe(true);
  });
});

describe('the organisation\'s categories', () => {
  it('create one from the list or with a new name; a repeated name (any case) is refused', async () => {
    const { id } = await newCall();
    expect((await post(id, { action: 'create_category', name: 'Evaluator', permissions: { evaluate_assigned: true } }, 'ana')).status).toBe(200);
    expect((await post(id, { action: 'create_category', name: 'Head of Research' }, 'ana')).status).toBe(200);
    const dup = await post(id, { action: 'create_category', name: '  evaluator ' }, 'ana');
    expect(dup).toMatchObject({ status: 409 });
    expect(dup.body.error).toContain('already a category');
    expect((await post(id, { action: 'create_category', name: '' }, 'ana')).status).toBe(409);
    expect(db.tables.call_team_categories.map((c) => c.name).sort()).toEqual(['Administrator', 'Evaluator', 'Head of Research']);
  });

  it('categories belong to the organisation, not to the call: another call sees them, another organisation does not', async () => {
    const one = await newCall('One'); const two = await newCall('Two', 'carl');
    await post(one.id, { action: 'create_category', name: 'Legal' }, 'ana');
    expect((await team(two.id, 'carl')).body.categories.map((c: { name: string }) => c.name)).toContain('Legal');
    const foreign = await newCall('Not yours', 'otto');
    expect((await team(foreign.id, 'otto')).body.categories.map((c: { name: string }) => c.name)).not.toContain('Legal');
  });

  it('rename keeps the people, refuses a name already taken', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator' }, 'ana'); await post(id, { action: 'create_category', name: 'Analyst' }, 'ana');
    expect((await post(id, { action: 'rename_category', categoryId: categoryId('Evaluator'), name: 'Reviewer' }, 'ana')).status).toBe(200);
    expect((await post(id, { action: 'rename_category', categoryId: categoryId('Reviewer'), name: 'analyst' }, 'ana')).status).toBe(409);
    expect(db.tables.call_team_categories.map((c) => c.name)).toContain('Reviewer');
  });

  it('delete: refused while anyone is in it — in this call or in ANY other call of the organisation — allowed when empty', async () => {
    const one = await newCall('One'); const two = await newCall('Two', 'carl');
    await post(one.id, { action: 'create_category', name: 'Evaluator' }, 'ana');
    const ev = categoryId('Evaluator');
    await post(two.id, { action: 'add_member', userId: 'bob', categoryId: ev }, 'carl');   // somebody in ANOTHER call
    const refused = await post(one.id, { action: 'delete_category', categoryId: ev }, 'ana');
    expect(refused).toMatchObject({ status: 409 });
    expect(refused.body.error).toContain('still has 1 person');
    expect(db.tables.call_team_categories.some((c) => c.id === ev)).toBe(true);
    await post(two.id, { action: 'remove_member', userId: 'bob' }, 'carl');
    expect((await post(one.id, { action: 'delete_category', categoryId: ev }, 'ana')).status).toBe(200);
    expect(db.tables.call_team_categories.some((c) => c.id === ev)).toBe(false);
  });

  it('switching a category\'s permissions applies to everybody in it, in every call', async () => {
    const one = await newCall('One'); const two = await newCall('Two', 'carl');
    await post(one.id, { action: 'create_category', name: 'Manager', permissions: { configure_call: true } }, 'ana');
    const mg = categoryId('Manager');
    await post(one.id, { action: 'add_member', userId: 'dora', categoryId: mg }, 'ana');
    await post(two.id, { action: 'add_member', userId: 'bob', categoryId: mg }, 'carl');
    await post(one.id, { action: 'set_category_permissions', categoryId: mg, permissions: { configure_call: false, evaluate_assigned: true } }, 'ana');
    as('dora'); expect((await generalPatch(json('PATCH', { baseVersion: row(one.id).config_version, description: 'x' }), params(one.id)).then(read)).status).toBe(403);
    as('bob'); expect((await generalPatch(json('PATCH', { baseVersion: row(two.id).config_version, description: 'x' }), params(two.id)).then(read)).status).toBe(403);
  });

  it('a category change that would leave ANOTHER call without an administrator is refused, naming it', async () => {
    const one = await newCall('Call One'); const two = await newCall('Call Two', 'carl');
    await post(one.id, { action: 'create_category', name: 'Lead', permissions: { configure_call: true, manage_team: true } }, 'ana');
    const lead = categoryId('Lead');
    // In "Call Two" the ONLY administrator is somebody in "Lead"; in "Call One" there is also ana (Administrator).
    await post(two.id, { action: 'add_member', userId: 'dora', categoryId: lead }, 'carl');
    await post(two.id, { action: 'remove_member', userId: 'carl' }, 'dora');
    const refused = await post(one.id, { action: 'set_category_permissions', categoryId: lead, permissions: { evaluate_assigned: true } }, 'ana');
    expect(refused).toMatchObject({ status: 409 });
    expect(refused.body.error).toContain(NO_ADMINISTRATOR);
    expect(refused.body.error).toContain('Call Two');
    expect(db.tables.call_team_categories.find((c) => c.id === lead)!.permissions).toMatchObject({ configure_call: true, manage_team: true });
  });
});

describe('who can be added', () => {
  it('only ACTIVE members of the organisation; the list shows who cannot, and why', async () => {
    const { id } = await newCall();
    db.tables.investor_firm_seat_invites.push({ id: 'i1', catalog_entity_id: FIRM, email: 'reserved@external.com', status: 'open' });
    db.tables.matchdeal_investor_members.push({ id: 'm-gone', user_id: 'gone', catalog_entity_id: FIRM, status: 'revoked', role: 'member', created_at: '2026-01-01' });
    db.users.set('gone', { id: 'gone', email: 'gone@example.com' });
    const payload = (await team(id, 'ana')).body;
    const byEmail = Object.fromEntries(payload.candidates.map((c: { email: string }) => [c.email, c]));
    expect(byEmail['bob@example.com']).toMatchObject({ eligible: true, name: 'Bob Builder', userId: 'bob' });
    expect(byEmail['reserved@external.com']).toMatchObject({ eligible: false, reason: NO_SEAT_REASON, userId: null });
    expect(byEmail['gone@example.com']).toBeUndefined();     // a revoked seat is not listed
    expect(byEmail['ana@example.com']).toBeUndefined();      // already in the team
  });
  it('the server refuses somebody without a seat, or from another organisation, even if the screen is bypassed', async () => {
    const { id } = await newCall();
    const adminCat = categoryId('Administrator');
    expect(await post(id, { action: 'add_member', userId: 'otto', categoryId: adminCat }, 'ana')).toMatchObject({ status: 409, body: { error: NO_SEAT_REASON } });
    expect(await post(id, { action: 'add_member', userId: 'nobody', categoryId: adminCat }, 'ana')).toMatchObject({ status: 409 });
    expect(await post(id, { action: 'add_member', userId: 'bob', categoryId: 'not-a-category' }, 'ana')).toMatchObject({ status: 409 });
    expect(membersOf(id)).toHaveLength(1);
  });
  it('adding twice is refused; people appear in their category box with their effective permissions', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator', permissions: { evaluate_assigned: true, view_all_applications: true } }, 'ana');
    const ev = categoryId('Evaluator');
    await post(id, { action: 'add_member', userId: 'bob', categoryId: ev }, 'ana');
    expect((await post(id, { action: 'add_member', userId: 'bob', categoryId: ev }, 'ana')).status).toBe(409);
    await post(id, { action: 'set_overrides', userId: 'bob', overrides: { view_all_applications: false } }, 'ana');
    const bob = (await team(id, 'ana')).body.members.find((m: { userId: string }) => m.userId === 'bob');
    expect(bob).toMatchObject({ name: 'Bob Builder', categoryId: ev, overrides: { view_all_applications: false } });
    expect(bob.effective).toMatchObject({ evaluate_assigned: true, view_all_applications: false, configure_call: false });
  });
  it('a person can be moved to another category', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator' }, 'ana'); await post(id, { action: 'create_category', name: 'Analyst' }, 'ana');
    await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Evaluator') }, 'ana');
    expect((await post(id, { action: 'set_category', userId: 'bob', categoryId: categoryId('Analyst') }, 'ana')).status).toBe(200);
    expect(membersOf(id).find((m) => m.user_id === 'bob')!.category_id).toBe(categoryId('Analyst'));
  });
});

describe('a call is never left without an administrator', () => {
  it('removing the only one, moving them to a lesser category, or switching either permission off for them is refused', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator' }, 'ana');
    for (const body of [
      { action: 'remove_member', userId: 'ana' },
      { action: 'set_category', userId: 'ana', categoryId: categoryId('Evaluator') },
      { action: 'set_overrides', userId: 'ana', overrides: { manage_team: false } },
      { action: 'set_overrides', userId: 'ana', overrides: { configure_call: false } },
      { action: 'set_category_permissions', categoryId: categoryId('Administrator'), permissions: { configure_call: true } },
    ]) {
      const res = await post(id, body, 'ana');
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error).toBe(NO_ADMINISTRATOR);
    }
    expect(membersOf(id)).toMatchObject([{ user_id: 'ana', category_id: categoryId('Administrator'), permission_overrides: {} }]);
  });
  it('with a second administrator the first may leave', async () => {
    const { id } = await newCall();
    await post(id, { action: 'add_member', userId: 'carl', categoryId: categoryId('Administrator') }, 'ana');
    expect((await post(id, { action: 'remove_member', userId: 'ana' }, 'ana')).status).toBe(200);
    expect(membersOf(id).map((m) => m.user_id)).toEqual(['carl']);
  });
});

describe('the team is not configuration', () => {
  it('is edited with the call confirmed, open or closed, while the configuration stays locked', async () => {
    const { id } = await newCall();
    for (const status of ['validated', 'open', 'closed']) {
      Object.assign(row(id), { status, closes_at: status === 'open' ? new Date(Date.now() + 5 * 86_400_000).toISOString() : null });
      const added = await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Administrator') }, 'ana');
      expect(added.status, status).toBe(200);
      expect((await post(id, { action: 'remove_member', userId: 'bob' }, 'ana')).status, status).toBe(200);
    }
    row(id).status = 'validated';
    as('ana');
    expect((await generalPatch(json('PATCH', { baseVersion: row(id).config_version, name: 'x' }), params(id)).then(read)).body.code).toBe('locked');
  });
  it('every change goes into the call\'s history', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Evaluator' }, 'ana');
    const ev = categoryId('Evaluator');
    await post(id, { action: 'add_member', userId: 'bob', categoryId: ev }, 'ana');
    await post(id, { action: 'set_overrides', userId: 'bob', overrides: { evaluate_assigned: true } }, 'ana');
    await post(id, { action: 'remove_member', userId: 'bob' }, 'ana');
    expect(events(id, 'team_category_created')).toMatchObject([{ actor_user_id: 'ana', detail: { category: 'Evaluator' } }]);
    expect(events(id, 'team_member_added')).toMatchObject([{ actor_user_id: 'ana', detail: { userId: 'bob', category: 'Evaluator' } }]);
    expect(events(id, 'team_member_permissions_adjusted')).toHaveLength(1);
    expect(events(id, 'team_member_removed')).toHaveLength(1);
  });
});

describe('declared conflicts', () => {
  it('record a company and a note for a member of the team, and can be removed; a stranger to the team is refused', async () => {
    const { id } = await newCall();
    await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Administrator') }, 'ana');
    const ok = await post(id, { action: 'declare_conflict', userId: 'bob', companyName: ' Portfolio   Co ', note: 'board seat' }, 'ana');
    expect(ok.status).toBe(200);
    expect(ok.body.conflicts).toMatchObject([{ userId: 'bob', companyName: 'Portfolio Co', note: 'board seat', personName: 'Bob Builder' }]);
    expect((await post(id, { action: 'declare_conflict', userId: 'dora', companyName: 'X' }, 'ana')).status).toBe(409);
    expect((await post(id, { action: 'declare_conflict', userId: 'bob', companyName: '   ' }, 'ana')).status).toBe(409);
    const conflictId = db.tables.call_declared_conflicts[0].id as string;
    expect((await post(id, { action: 'remove_conflict', conflictId }, 'ana')).body.conflicts).toEqual([]);
  });
});

describe('duplicating a call', () => {
  it('copies the team, with each person\'s category and adjustments, and not the conflicts', async () => {
    const { id } = await newCall('Edition 2025');
    await post(id, { action: 'create_category', name: 'Evaluator', permissions: { evaluate_assigned: true } }, 'ana');
    await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Evaluator') }, 'ana');
    await post(id, { action: 'set_overrides', userId: 'bob', overrides: { final_decision: true } }, 'ana');
    await post(id, { action: 'declare_conflict', userId: 'bob', companyName: 'Portfolio Co' }, 'ana');
    as('ana');
    const copy = (await read(await duplicatePost(json('POST'), params(id)))).body.call as { id: string };
    expect(membersOf(copy.id).map((m) => [m.user_id, m.category_id, JSON.stringify(m.permission_overrides)]).sort())
      .toEqual([['ana', categoryId('Administrator'), '{}'], ['bob', categoryId('Evaluator'), '{"final_decision":true}']].sort());
    expect(db.tables.call_declared_conflicts.filter((c) => c.call_id === copy.id)).toEqual([]);
    expect(db.tables.call_team_categories).toHaveLength(2);   // the organisation's categories are shared, not copied
  });
});

describe('the list knows which calls you may configure', () => {
  it('per call, from the permissions of that call', async () => {
    const a = await newCall('Mine'); const b = await newCall('Carl\'s', 'carl');
    as('ana');
    const list = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    const byName = Object.fromEntries(list.body.calls.map((c: { name: string; canConfigure: boolean }) => [c.name, c.canConfigure]));
    expect(byName).toEqual({ Mine: true, 'Carl\'s': false });
    as('olga');
    const owner = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    expect(owner.body.calls.every((c: { canConfigure: boolean }) => c.canConfigure)).toBe(true);
    expect(a.id && b.id).toBeTruthy();
    expect(ALL_PERMISSIONS.configure_call).toBe(true);
  });
});

// Prompt 918 (follow-up to the I1 test) — the person's own category list offers the suggestions that do not exist yet: picking one creates it with sensible permissions and puts the person in it.
describe('a suggested category, picked from the person\'s own list', () => {
  const perms = (name: string) => db.tables.call_team_categories.find((c) => c.name === name)!.permissions as Record<string, boolean>;
  const on = (name: string) => Object.entries(perms(name)).filter(([, v]) => v).map(([k]) => k).sort();

  it('Evaluator starts with "Evaluate assigned" only (so it sees only what is assigned); Analyst with "View all applications"; Manager with everything except "Manage team"', async () => {
    const { id } = await newCall();
    for (const name of ['Evaluator', 'Analyst', 'Manager']) expect((await post(id, { action: 'create_category', name }, 'ana')).status, name).toBe(200);
    expect(on('Evaluator')).toEqual(['evaluate_assigned']);
    expect(on('Analyst')).toEqual(['view_all_applications']);
    expect(on('Manager')).toEqual(Object.keys(ALL_PERMISSIONS).filter((k) => k !== 'manage_team').sort());
  });

  it('a name that is not a suggestion starts with nothing, and an explicit set is always respected', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Head of Research' }, 'ana');
    await post(id, { action: 'create_category', name: 'Legal', permissions: { final_decision: true } }, 'ana');
    expect(on('Head of Research')).toEqual([]);
    expect(on('Legal')).toEqual(['final_decision']);
  });

  it('create_category with assignUserId adds a person who is not in the call, in the new category, and logs both', async () => {
    const { id } = await newCall();
    const res = await post(id, { action: 'create_category', name: 'Evaluator', assignUserId: 'bob' }, 'ana');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(membersOf(id)).toContainEqual(expect.objectContaining({ user_id: 'bob', category_id: categoryId('Evaluator') }));
    expect(res.body.members.find((m: { userId: string }) => m.userId === 'bob')).toMatchObject({ categoryId: categoryId('Evaluator'), effective: expect.objectContaining({ evaluate_assigned: true, configure_call: false }) });
    expect(events(id, 'team_category_created')).toHaveLength(1);
    expect(events(id, 'team_member_added')).toHaveLength(1);
  });

  it('…and moves a person who already is in the call', async () => {
    const { id } = await newCall();
    await post(id, { action: 'create_category', name: 'Analyst', assignUserId: 'bob' }, 'ana');
    const res = await post(id, { action: 'create_category', name: 'Evaluator', assignUserId: 'bob' }, 'ana');
    expect(res.status).toBe(200);
    expect(membersOf(id).filter((m) => m.user_id === 'bob')).toMatchObject([{ category_id: categoryId('Evaluator') }]);
    expect(events(id, 'team_member_category_changed')).toHaveLength(1);
  });

  it('is checked BEFORE anything is written: moving the only administrator out, or adding someone with no seat, leaves no half-made category', async () => {
    const { id } = await newCall();
    const alone = await post(id, { action: 'create_category', name: 'Evaluator', assignUserId: 'ana' }, 'ana');
    expect(alone).toMatchObject({ status: 409 });
    expect(alone.body.error).toBe(NO_ADMINISTRATOR);
    const noSeat = await post(id, { action: 'create_category', name: 'Analyst', assignUserId: 'someone-without-a-seat' }, 'ana');
    expect(noSeat).toMatchObject({ status: 409 });
    expect(noSeat.body.error).toBe(NO_SEAT_REASON);
    expect(db.tables.call_team_categories.map((c) => c.name)).toEqual(['Administrator']);
  });

  it('a repeated name is refused and nobody is moved; somebody who cannot manage the team cannot do it', async () => {
    const { id } = await newCall();
    await post(id, { action: 'add_member', userId: 'bob', categoryId: categoryId('Administrator') }, 'ana');
    expect((await post(id, { action: 'create_category', name: 'administrator', assignUserId: 'bob' }, 'ana')).status).toBe(409);
    await post(id, { action: 'create_category', name: 'Evaluator' }, 'ana');
    await post(id, { action: 'set_category', userId: 'bob', categoryId: categoryId('Evaluator') }, 'ana');
    expect((await post(id, { action: 'create_category', name: 'Analyst', assignUserId: 'bob' }, 'bob')).status).toBe(403);
    expect(db.tables.call_team_categories.map((c) => c.name).sort()).toEqual(['Administrator', 'Evaluator']);
  });
});
