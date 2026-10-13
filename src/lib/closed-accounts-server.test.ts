// Prompt 900 §A — the loader behind Startups › "Closed & deleted", over an in-memory database: which orgs are listed (closed OR
// deleted, never a live or merely suspended one), how each one ended and who did it, the people still attached with every OTHER hat
// they hold, and — per person and per account — whether Release email / Reopen account is available, with the reason when it is not.
// Fixture names start with zz-test- (the project rule for anything that stands in for a real record).
import { describe, expect, it } from 'vitest';
import { fakeAdmin, fakeDb, type FakeDb } from '@/test/fake-supabase';
import { loadClosedAccounts } from './closed-accounts-server';

const NOW = new Date('2026-10-13T12:00:00Z');

const ORG_DELETED = '00000000-0000-4000-8000-0000000000a1';   // the real case: deleted by moderation, one owner who also holds an investor seat
const ORG_OWNER_OPEN = '00000000-0000-4000-8000-0000000000a2'; // closed by its owner, reopen window still open
const ORG_OWNER_GONE = '00000000-0000-4000-8000-0000000000a3'; // closed by its owner, window ended
const ORG_PLATFORM = '00000000-0000-4000-8000-0000000000a4';   // closed by the platform, nobody attached
const ORG_GDPR = '00000000-0000-4000-8000-0000000000a5';       // deleted, one member in a GDPR erasure
const ORG_BLOCKED = '00000000-0000-4000-8000-0000000000a6';    // deleted, one member's e-mail is blocked
const ORG_BOTH = '00000000-0000-4000-8000-0000000000a7';       // deleted AND closed
const ORG_LIVE = '00000000-0000-4000-8000-0000000000b1';
const ORG_SUSPENDED = '00000000-0000-4000-8000-0000000000b2';

const U = { alex: 'u-alex', ownerOpen: 'u-owner-open', ownerGone: 'u-owner-gone', g1: 'u-g1', g2: 'u-g2', b1: 'u-b1', b2: 'u-b2', both: 'u-both', live: 'u-live', admin: 'u-admin', admin2: 'u-admin2' };

function org(id: string, name: string, over: Record<string, unknown> = {}) {
  return { id, name, is_test: false, is_internal: false, created_at: '2026-07-31T09:00:00Z', moderation_status: 'active', closed_at: null, closed_by: null, closed_reason: null, purge_after: null, ...over };
}

function world(): FakeDb {
  const d = fakeDb({
    orgs: [
      org(ORG_DELETED, 'zz-test-caramel', { is_test: true, is_internal: true, moderation_status: 'deleted' }),
      org(ORG_OWNER_OPEN, 'zz-test-owner-open', { closed_at: '2026-10-01T10:00:00Z', closed_by: U.ownerOpen, closed_reason: 'owner', purge_after: '2026-10-31T10:00:00Z' }),
      org(ORG_OWNER_GONE, 'zz-test-owner-gone', { closed_at: '2026-08-01T10:00:00Z', closed_by: U.ownerGone, closed_reason: 'owner', purge_after: '2026-08-31T10:00:00Z' }),
      org(ORG_PLATFORM, 'zz-test-platform', { closed_at: '2026-09-30T10:00:00Z', closed_by: U.admin, closed_reason: 'platform' }),
      org(ORG_GDPR, 'zz-test-gdpr', { moderation_status: 'deleted' }),
      org(ORG_BLOCKED, 'zz-test-blocked', { moderation_status: 'deleted' }),
      org(ORG_BOTH, 'zz-test-both', { moderation_status: 'deleted', closed_at: '2026-10-12T10:00:00Z', closed_by: U.admin, closed_reason: 'last_member_deleted' }),
      org(ORG_LIVE, 'zz-test-live'),
      org(ORG_SUSPENDED, 'zz-test-suspended', { moderation_status: 'suspended' }),
    ],
    org_members: [
      { org_id: ORG_DELETED, user_id: U.alex, role: 'owner' },
      { org_id: ORG_OWNER_OPEN, user_id: U.ownerOpen, role: 'owner' },
      { org_id: ORG_OWNER_GONE, user_id: U.ownerGone, role: 'owner' },
      { org_id: ORG_GDPR, user_id: U.g1, role: 'owner' },
      { org_id: ORG_GDPR, user_id: U.g2, role: 'member' },
      { org_id: ORG_BLOCKED, user_id: U.b1, role: 'owner' },
      { org_id: ORG_BLOCKED, user_id: U.b2, role: 'member' },
      { org_id: ORG_LIVE, user_id: U.live, role: 'owner' },
    ],
    incubators: [
      { id: 'inc-open', name: 'zz-test-hub', closed_at: null },
      { id: 'inc-closed', name: 'zz-test-old-hub', closed_at: '2026-09-01T00:00:00Z' },
    ],
    incubator_members: [
      { user_id: U.alex, role: 'owner', status: 'invited', incubator_id: 'inc-open' },     // invitation not accepted: not live
      { user_id: U.g2, role: 'manager', status: 'active', incubator_id: 'inc-closed' },    // active, but in a closed ecosystem organisation: not live
      { user_id: U.b2, role: 'manager', status: 'active', incubator_id: 'inc-open' },      // live
    ],
    catalog_entities: [
      { id: 'firm-ok', name: 'zz-test-invest-green', moderation_status: 'active', moderation_suspended_until: null },
      { id: 'firm-susp', name: 'zz-test-suspended-fund', moderation_status: 'suspended', moderation_suspended_until: null },
    ],
    matchdeal_investor_members: [
      { user_id: U.alex, role: 'member', status: 'active', catalog_entity_id: 'firm-ok' },      // live
      { user_id: U.g1, role: 'member', status: 'active', catalog_entity_id: 'firm-susp' },      // firm under an open-ended suspension: not live
    ],
    blocked_emails: [{ email: 'b1@zz-test.example' }],
    gdpr_requests: [
      { claimant_email: 'g1@zz-test.example', claimant_user_id: U.g1, kind: 'erase', status: 'pending', resolution_method: null },
      // other kinds / other outcomes do not count:
      { claimant_email: 'live@zz-test.example', claimant_user_id: U.live, kind: 'erase', status: 'resolved', resolution_method: 'rectified' },
    ],
    account_moderation_actions: [
      { target_type: 'org', target_id: ORG_DELETED, action: 'suspend', justification: 'spam', actor: U.admin, created_at: '2026-08-29T10:00:00Z' },
      { target_type: 'org', target_id: ORG_DELETED, action: 'delete', justification: 'ciau', actor: U.admin, created_at: '2026-09-29T10:00:00Z' },
      { target_type: 'org', target_id: ORG_BOTH, action: 'delete', justification: 'abuse report', actor: U.admin, created_at: '2026-10-05T10:00:00Z' },
    ],
    admin_audit_log: [
      { admin_user_id: null, action: 'org_closed_by_owner', subject_id: ORG_OWNER_OPEN, detail: { ownerEmail: 'owner-open@zz-test.example' }, created_at: '2026-10-01T10:00:00Z' },
      { admin_user_id: U.admin, action: 'org_member_released', subject_id: ORG_BOTH, detail: { email: 'both@zz-test.example', role: 'owner', reason: 'owner invite needs the e-mail', closedByThisRelease: true }, created_at: '2026-10-12T10:00:00Z' },
    ],
  });
  d.evalOr = true;
  d.authUsers = {
    [U.alex]: { email: 'alex@zz-test.example', email_confirmed_at: '2026-07-31T09:05:00Z' },
    [U.ownerOpen]: { email: 'owner-open@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.ownerGone]: { email: 'owner-gone@zz-test.example', email_confirmed_at: null },
    [U.g1]: { email: 'g1@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.g2]: { email: 'g2@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.b1]: { email: 'b1@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.b2]: { email: 'b2@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.live]: { email: 'live@zz-test.example', email_confirmed_at: '2026-07-01T09:05:00Z' },
    [U.admin]: { email: 'admin@zz-test.example', email_confirmed_at: '2026-01-01T00:00:00Z' },
  };
  return d;
}

async function load() {
  const accounts = await loadClosedAccounts(fakeAdmin(world()), NOW);
  const by = (id: string) => accounts.find((a) => a.orgId === id)!;
  return { accounts, by };
}

describe('which accounts are listed', () => {
  it('every account that ended — closed (by anyone) or deleted by moderation — and nothing that is merely live or suspended', async () => {
    const { accounts } = await load();
    expect(accounts.map((a) => a.orgId).sort()).toEqual([ORG_DELETED, ORG_OWNER_OPEN, ORG_OWNER_GONE, ORG_PLATFORM, ORG_GDPR, ORG_BLOCKED, ORG_BOTH].sort());
  });

  it('most recently ended first', async () => {
    const { accounts } = await load();
    const whens = accounts.map((a) => a.when ?? '');
    expect(whens).toEqual([...whens].sort().reverse());
  });
});

describe('how each one ended, when, why and by whom', () => {
  it('deleted by moderation: the date, the reason and the admin come from the moderation history (the latest delete, not the earlier suspend)', async () => {
    const a = (await load()).by(ORG_DELETED);
    expect(a.ways).toEqual(['moderation_deleted']);
    expect(a.deleted).toEqual({ at: '2026-09-29T10:00:00Z', by: 'admin@zz-test.example', reason: 'ciau' });
    expect(a.closed).toBeNull();
    expect(a.when).toBe('2026-09-29T10:00:00Z');
    expect(a.isTest && a.isInternal).toBe(true);
  });

  it('closed by its owner: the owner is who closed it, with the retention clock', async () => {
    const { by } = await load();
    expect(by(ORG_OWNER_OPEN)).toMatchObject({ ways: ['owner_closed'], deleted: null, closed: { at: '2026-10-01T10:00:00Z', by: 'owner-open@zz-test.example', reason: null }, ownerReopenable: true, daysToPurge: 18 });
    expect(by(ORG_OWNER_GONE)).toMatchObject({ ways: ['owner_closed'], ownerReopenable: false, daysToPurge: 0 });
  });

  it('closed by the platform, and deleted-then-closed, each in its own words', async () => {
    const { by } = await load();
    expect(by(ORG_PLATFORM).ways).toEqual(['platform_closed']);
    expect(by(ORG_PLATFORM).closed).toEqual({ at: '2026-09-30T10:00:00Z', by: 'admin@zz-test.example', reason: null });
    expect(by(ORG_BOTH).ways).toEqual(['moderation_deleted', 'last_member']);
    // deleted first, closed later: each keeps its own date, person and words, and the account sorts by the later one
    expect(by(ORG_BOTH).deleted).toEqual({ at: '2026-10-05T10:00:00Z', by: 'admin@zz-test.example', reason: 'abuse report' });
    // the reason of a release that closed the account is read from the audit entry
    expect(by(ORG_BOTH).closed).toEqual({ at: '2026-10-12T10:00:00Z', by: 'admin@zz-test.example', reason: 'owner invite needs the e-mail' });
    expect(by(ORG_BOTH).when).toBe('2026-10-12T10:00:00Z');
  });

  it('tells the story in a short history, newest first, with who did each thing', async () => {
    const { by } = await load();
    expect(by(ORG_DELETED).trail.map((t) => t.text)).toEqual(['Deleted by moderation — “ciau”', 'Suspended — “spam”']);
    expect(by(ORG_DELETED).trail[0].by).toBe('admin@zz-test.example');
    expect(by(ORG_BOTH).trail[0].text).toContain('Released both@zz-test.example (owner)');
    expect(by(ORG_BOTH).trail[0].text).toContain('the account was closed');
    expect(by(ORG_OWNER_OPEN).trail[0]).toMatchObject({ action: 'org_closed_by_owner', by: 'owner-open@zz-test.example' });
  });
});

describe('the people attached, and what else each one holds', () => {
  it('lists e-mail, role and whether the e-mail was confirmed', async () => {
    const m = (await load()).by(ORG_DELETED).members;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ email: 'alex@zz-test.example', role: 'owner', emailConfirmed: true });
    const gone = (await load()).by(ORG_OWNER_GONE).members[0];
    expect(gone.emailConfirmed).toBe(false);
  });

  it('shows the other hats: a live investor seat lets the person in, an invitation not accepted is listed but not live', async () => {
    const alex = (await load()).by(ORG_DELETED).members[0];
    expect(alex.hats.investor).toEqual([{ name: 'zz-test-invest-green', role: 'member', live: true }]);
    expect(alex.hats.ecosystem).toEqual([{ name: 'zz-test-hub', role: 'owner', status: 'invited', live: false }]);
    expect(alex.signIn).toBe('Signs in through Investor — zz-test-invest-green');
  });

  it('a hat is not live when its organisation is closed or its firm is under a suspension', async () => {
    const { by } = await load();
    const g2 = by(ORG_GDPR).members.find((m) => m.userId === U.g2)!;
    expect(g2.hats.ecosystem[0]).toMatchObject({ name: 'zz-test-old-hub', live: false });
    expect(g2.signIn).toMatch(/^Locked out by this account/);
    const g1 = by(ORG_GDPR).members.find((m) => m.userId === U.g1)!;
    expect(g1.hats.investor[0]).toMatchObject({ name: 'zz-test-suspended-fund', live: false });
  });

  it('owners are listed before members', async () => {
    const roles = (await load()).by(ORG_BLOCKED).members.map((m) => m.role);
    expect(roles).toEqual(['owner', 'member']);
  });

  it('an account nobody is attached to any more has no people', async () => {
    expect((await load()).by(ORG_PLATFORM).members).toEqual([]);
  });
});

describe('availability of the two actions', () => {
  it('the real case: Reopen and Release are both available for a deleted account with a clean member', async () => {
    const a = (await load()).by(ORG_DELETED);
    expect(a.reopen).toEqual({ ok: true });
    expect(a.members[0].release).toEqual({ ok: true });
  });

  it('a member in a GDPR erasure turns both off for the whole account, with the reason, and flags the account', async () => {
    const a = (await load()).by(ORG_GDPR);
    expect(a.gdprErasure).toBe('pending');
    expect(a.reopen).toMatchObject({ ok: false, reason: expect.stringContaining('GDPR erasure (pending)') });
    for (const m of a.members) expect(m.release).toMatchObject({ ok: false, reason: expect.stringContaining('GDPR erasure') });
    // by user id AND by e-mail; an erasure resolved another way, or of a live account, is not counted
    expect((await load()).by(ORG_DELETED).gdprErasure).toBeNull();
  });

  it('a blocked e-mail turns Release off for that person only, and Reopen off for the account', async () => {
    const a = (await load()).by(ORG_BLOCKED);
    const b1 = a.members.find((m) => m.userId === U.b1)!;
    const b2 = a.members.find((m) => m.userId === U.b2)!;
    expect(b1.blocked).toBe(true);
    expect(b1.release).toMatchObject({ ok: false, reason: expect.stringContaining('blocked list') });
    expect(b1.signIn).toMatch(/^E-mail on the blocked list/);
    expect(b2.release).toEqual({ ok: true });
    expect(a.reopen).toMatchObject({ ok: false, reason: expect.stringContaining('blocked list') });
  });

  it('closed by its owner, window open: Release and Reopen are off (the owner reopen is the way back); after the window Release is allowed', async () => {
    const { by } = await load();
    expect(by(ORG_OWNER_OPEN).members[0].release).toMatchObject({ ok: false, reason: expect.stringContaining('2026-10-31') });
    expect(by(ORG_OWNER_OPEN).reopen).toMatchObject({ ok: false, reason: expect.stringContaining('owner reopen') });
    expect(by(ORG_OWNER_GONE).members[0].release).toEqual({ ok: true });
  });

  it('deleted and also closed: Reopen is off', async () => {
    const a = (await load()).by(ORG_BOTH);
    expect(a.reopen).toMatchObject({ ok: false, reason: expect.stringContaining('also closed') });
  });
});

describe('an empty database', () => {
  it('lists nothing and asks for nothing more', async () => {
    const d = fakeDb({ orgs: [org(ORG_LIVE, 'zz-test-live')] });
    d.evalOr = true;
    expect(await loadClosedAccounts(fakeAdmin(d), NOW)).toEqual([]);
  });
});
