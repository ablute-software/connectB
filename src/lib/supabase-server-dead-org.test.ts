// Prompt 900, Part C — a live hat is never trapped by a dead org.
//
// The four cases the prompt names run through the REAL resolveRoleSignals (a fake Supabase underneath, so the
// `.from('orgs')` read is a real filtered read, not a canned answer) and the REAL decideRole:
//
//   deleted + ecosystem membership → incubator      deleted + investor seat → investor
//   deleted, nothing else          → no hat at all   suspended + ecosystem   → still a founder at this layer
//
// What this file proves and what it cannot: it proves which WORKSPACE a person resolves to once they are through the
// door. The door itself — "is this person let in at all" — is SQL (account_access_state() → is_account_suspended()), which
// vitest cannot run; it is proved against the real functions and the real production data in a rolled-back transaction
// (scripts/verify-closed-deleted-900.sql). Both halves are needed: with only this half a deleted-org person with a live
// hat would still be bounced to /suspended; with only the SQL half they would be let in and still land on the dead org.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('./investor-membership', () => ({ resolveActiveInvestorMember: vi.fn(async () => null) }));
vi.mock('./investor-entity-claims-capability', () => ({ investorEntityClaimsAvailable: async () => false }));

import { decideRole, hatsFromSignals, resolveRoleSignals } from './supabase-server';
import { isLiveFounderOrg } from './founder-hat';
import { resolveActiveInvestorMember } from './investor-membership';
import { fakeAdmin, fakeDb } from '@/test/fake-supabase';

const USER = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'alexandrameira.ablute@example.test';
const ORG = '45e28905-0000-4000-8000-000000000001';

interface World {
  orgStatus?: 'active' | 'suspended' | 'deleted';
  closedAt?: string | null;
  /** false = the person has no startup org at all. */
  hasOrg?: boolean;
  /** The row of `orgs` is not readable (RLS, or a column that does not exist yet): the member row exists, the org does not come back. */
  orgUnreadable?: boolean;
  ecosystem?: boolean;
  investorSeat?: boolean;
}

async function resolve(w: World) {
  const db = fakeDb({
    platform_admins: [],
    org_members: w.hasOrg === false ? [] : [{ org_id: ORG, user_id: USER, role: 'owner' }],
    orgs: w.orgUnreadable ? [] : [{ id: ORG, name: 'Caramel Biscuit', moderation_status: w.orgStatus ?? 'active', closed_at: w.closedAt ?? null }],
    access_grants: [],
  });
  db.rpc = { has_active_incubator_membership: !!w.ecosystem };
  vi.mocked(resolveActiveInvestorMember).mockResolvedValue(w.investorSeat ? ({ id: 'seat-1' } as never) : null);
  const signals = await resolveRoleSignals(USER, EMAIL, fakeAdmin(db) as never, '2026-01-01T00:00:00Z');
  return { signals, role: decideRole(signals), hats: hatsFromSignals(signals) };
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-test');
  vi.mocked(resolveActiveInvestorMember).mockReset();
});

describe('Prompt 900 C — the four cases', () => {
  it('deleted org + active ecosystem membership → incubator (the dead org is simply outside the resolution)', async () => {
    const r = await resolve({ orgStatus: 'deleted', ecosystem: true });
    expect(r.signals.hasOpenFounderOrg).toBe(false);
    expect(r.role).toBe('incubator');
    expect(r.hats).toEqual({ founder: false, incubator: true, investor: false });
  });

  it('deleted org + active investor seat → investor', async () => {
    const r = await resolve({ orgStatus: 'deleted', investorSeat: true });
    expect(r.signals.hasOpenFounderOrg).toBe(false);
    expect(r.role).toBe('investor');
    expect(r.hats).toEqual({ founder: false, incubator: false, investor: true });
  });

  it('deleted org and nothing else → no hat at all (the door keeps this person out, as today — proved in SQL)', async () => {
    const r = await resolve({ orgStatus: 'deleted' });
    expect(r.signals.hasOpenFounderOrg).toBe(false);
    expect(r.role).toBe('none');
    expect(r.hats).toEqual({ founder: false, incubator: false, investor: false });
  });

  it('suspended org + ecosystem membership → the founder hat is KEPT: a suspension is a sanction on the person, the door (SQL) blocks them whatever else they hold', async () => {
    const r = await resolve({ orgStatus: 'suspended', ecosystem: true });
    expect(r.signals.hasOpenFounderOrg).toBe(true);
    expect(r.role).toBe('founder');
    expect(r.hats).toEqual({ founder: true, incubator: true, investor: false });
  });
});

describe('Prompt 900 C — what did not change, and the edges', () => {
  it('a live org + ecosystem membership → founder, exactly as before (lands on /pipeline; the hat switcher crosses over)', async () => {
    const r = await resolve({ ecosystem: true });
    expect(r.role).toBe('founder');
    expect(r.hats.founder).toBe(true);
  });

  it('a closed org (closed_at) is a dead org too: it does not hold the founder hat, the live hat wins', async () => {
    const r = await resolve({ closedAt: '2026-09-30T10:00:00Z', ecosystem: true });
    expect(r.signals.hasOpenFounderOrg).toBe(false);
    expect(r.role).toBe('incubator');
  });

  it('a deleted org does not hide an investor hat that is already there through an access grant', async () => {
    const db = fakeDb({
      platform_admins: [],
      org_members: [{ org_id: ORG, user_id: USER, role: 'owner' }],
      orgs: [{ id: ORG, moderation_status: 'deleted', closed_at: null }],
      access_grants: [{ id: 'g1', grantee_email: EMAIL }],
    });
    db.rpc = { has_active_incubator_membership: false };
    const signals = await resolveRoleSignals(USER, EMAIL, fakeAdmin(db) as never, '2026-01-01T00:00:00Z');
    expect(decideRole(signals)).toBe('investor');
  });

  it('an org row that cannot be read keeps the pre-900 behaviour (founder) — a missing column must not turn into "every founder lost their workspace"', async () => {
    const r = await resolve({ orgUnreadable: true });
    expect(r.signals.hasOpenFounderOrg).toBe(true);
    expect(r.role).toBe('founder');
  });

  it('no org at all → no founder hat, no read of orgs needed', async () => {
    const r = await resolve({ hasOrg: false, ecosystem: true });
    expect(r.signals.hasOpenFounderOrg).toBe(false);
    expect(r.role).toBe('incubator');
  });

  it('a platform admin is still a developer whatever state the org is in', async () => {
    const db = fakeDb({
      platform_admins: [{ user_id: USER }],
      org_members: [{ org_id: ORG, user_id: USER, role: 'owner' }],
      orgs: [{ id: ORG, moderation_status: 'deleted', closed_at: null }],
      access_grants: [],
    });
    db.rpc = { has_active_incubator_membership: false };
    const signals = await resolveRoleSignals(USER, EMAIL, fakeAdmin(db) as never, '2026-01-01T00:00:00Z');
    expect(decideRole(signals)).toBe('developer');
  });
});

describe('isLiveFounderOrg — the one definition of "this org is a founder hat" (server and middleware both use it)', () => {
  it.each([
    ['active, open', { closed_at: null, moderation_status: 'active' }, true],
    ['suspended is NOT dead: the door blocks it, the hat stays', { closed_at: null, moderation_status: 'suspended' }, true],
    ['deleted', { closed_at: null, moderation_status: 'deleted' }, false],
    ['closed', { closed_at: '2026-09-30T10:00:00Z', moderation_status: 'active' }, false],
    ['closed and deleted', { closed_at: '2026-09-30T10:00:00Z', moderation_status: 'deleted' }, false],
    ['no moderation_status column yet (a migration lags)', { closed_at: null }, true],
    ['row not readable', null, true],
    ['row not found', undefined, true],
  ] as const)('%s → %s', (_label, org, expected) => {
    expect(isLiveFounderOrg(org)).toBe(expected);
  });
});
