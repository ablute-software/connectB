// Prompt 900 §A/§B — the rules of the "Closed & deleted" tab as pure functions: which orgs are dead, how each ended, what a person
// attached to one holds, and when Release email / Reopen account is available (with the reason when it is not). The SQL functions
// re-check all of it in the transaction of the write; these tests pin the statement of each rule and the ORDER of the reasons,
// which is the order the database would refuse in.
import { describe, expect, it } from 'vitest';
import {
  closureWays, isDeadOrg, liveHatNames, MIN_REASON_LENGTH, ownerReopenable, refusalMessage, refusalStatus,
  releaseAvailability, reopenAvailability, signInHint, type MemberHats, type OrgLifeFacts,
} from './closed-accounts';

const NOW = new Date('2026-10-13T12:00:00Z');
const live = (over: Partial<OrgLifeFacts> = {}): OrgLifeFacts => ({ moderationStatus: 'active', closedAt: null, closedReason: null, purgeAfter: null, ...over });
const deleted = (over: Partial<OrgLifeFacts> = {}): OrgLifeFacts => live({ moderationStatus: 'deleted', ...over });
const NO_HATS: MemberHats = { ecosystem: [], investor: [] };

describe('isDeadOrg — what belongs in the tab', () => {
  it.each([
    ['active and open', live(), false],
    ['suspended and open (still a live account with a sanction on it)', live({ moderationStatus: 'suspended' }), false],
    ['deleted by moderation', deleted(), true],
    ['closed by anyone', live({ closedAt: '2026-09-30T10:00:00Z', closedReason: 'platform' }), true],
    ['closed and deleted', deleted({ closedAt: '2026-09-30T10:00:00Z' }), true],
    ['closed with no reason recorded', live({ closedAt: '2026-09-30T10:00:00Z' }), true],
  ] as const)('%s → %s', (_n, org, expected) => expect(isDeadOrg(org)).toBe(expected));
});

describe('closureWays — how it ended', () => {
  it('says each way in its own words, and both when there are two', () => {
    expect(closureWays(deleted())).toEqual(['moderation_deleted']);
    expect(closureWays(live({ closedAt: 'x', closedReason: 'owner' }))).toEqual(['owner_closed']);
    expect(closureWays(live({ closedAt: 'x', closedReason: 'platform' }))).toEqual(['platform_closed']);
    expect(closureWays(live({ closedAt: 'x', closedReason: 'last_member_deleted' }))).toEqual(['last_member']);
    expect(closureWays(live({ closedAt: 'x' }))).toEqual(['closed_unspecified']);
    expect(closureWays(deleted({ closedAt: 'x', closedReason: 'last_member_deleted' }))).toEqual(['moderation_deleted', 'last_member']);
  });
});

describe('reopenAvailability — Reopen account', () => {
  const ctx = { gdpr: null, anyMemberBlocked: false } as const;

  it('available for an account deleted by moderation, not closed, inside (or without) a retention window', () => {
    expect(reopenAvailability(deleted(), ctx, NOW)).toEqual({ ok: true });
    expect(reopenAvailability(deleted({ purgeAfter: '2026-11-01T00:00:00Z' }), ctx, NOW)).toEqual({ ok: true });
  });

  it('refuses an account that is not deleted, and says why for each kind', () => {
    expect(reopenAvailability(live({ moderationStatus: 'suspended' }), ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('this one is suspended') });
    expect(reopenAvailability(live(), ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('this one is active') });
    expect(reopenAvailability(live({ closedAt: '2026-09-30T10:00:00Z', closedReason: 'platform' }), ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('this one is closed') });
    // the owner's closure has its own way back; the reason points at it instead of leaving a dead end
    expect(reopenAvailability(live({ closedAt: '2026-09-30T10:00:00Z', closedReason: 'owner' }), ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('owner reopen') });
  });

  it('refuses a deleted account that is also closed — reopening only the moderation status would not bring it back', () => {
    const r = reopenAvailability(deleted({ closedAt: '2026-09-30T10:00:00Z' }), ctx, NOW);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.reason).toContain('2026-09-30');
  });

  it('refuses once the retention window has passed (and on the very instant it ends)', () => {
    expect(reopenAvailability(deleted({ purgeAfter: '2026-10-12T00:00:00Z' }), ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('2026-10-12') });
    expect(reopenAvailability(deleted({ purgeAfter: NOW.toISOString() }), ctx, NOW)).toMatchObject({ ok: false });
  });

  it('refuses when a member is in a GDPR erasure, pending or done', () => {
    expect(reopenAvailability(deleted(), { gdpr: 'pending', anyMemberBlocked: false }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('GDPR erasure (pending)') });
    expect(reopenAvailability(deleted(), { gdpr: 'done', anyMemberBlocked: false }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('GDPR erasure (done)') });
  });

  it('refuses when any member’s e-mail is on the blocked list', () => {
    expect(reopenAvailability(deleted(), { gdpr: null, anyMemberBlocked: true }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('blocked list') });
  });

  it('gives the reasons in the order the database refuses in: status, closed, window, GDPR, blocked', () => {
    const everything = deleted({ closedAt: '2026-09-30T10:00:00Z', purgeAfter: '2026-10-01T00:00:00Z' });
    const bad = { gdpr: 'pending', anyMemberBlocked: true } as const;
    const first = reopenAvailability(everything, bad, NOW);
    expect(first.ok === false && first.reason).toContain('also closed');
    const second = reopenAvailability(deleted({ purgeAfter: '2026-10-01T00:00:00Z' }), bad, NOW);
    expect(second.ok === false && second.reason).toContain('retention window ended');
    const third = reopenAvailability(deleted(), bad, NOW);
    expect(third.ok === false && third.reason).toContain('GDPR');
  });
});

describe('releaseAvailability — Release email', () => {
  const ctx = { gdpr: null, memberBlocked: false } as const;

  it('available for any member of a deleted or closed account', () => {
    expect(releaseAvailability(deleted(), ctx, NOW)).toEqual({ ok: true });
    expect(releaseAvailability(live({ closedAt: '2026-09-30T10:00:00Z', closedReason: 'platform' }), ctx, NOW)).toEqual({ ok: true });
    expect(releaseAvailability(deleted({ closedAt: '2026-09-30T10:00:00Z', closedReason: 'last_member_deleted' }), ctx, NOW)).toEqual({ ok: true });
  });

  it('is for dead accounts only', () => {
    expect(releaseAvailability(live(), ctx, NOW)).toMatchObject({ ok: false });
    expect(releaseAvailability(live({ moderationStatus: 'suspended' }), ctx, NOW)).toMatchObject({ ok: false });
  });

  it('is refused while the owner can still reopen the account — releasing would leave nothing to reopen — and allowed after the window', () => {
    const inside = live({ closedAt: '2026-10-01T10:00:00Z', closedReason: 'owner', purgeAfter: '2026-10-31T10:00:00Z' });
    expect(releaseAvailability(inside, ctx, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('2026-10-31') });
    expect(releaseAvailability({ ...inside, purgeAfter: '2026-10-12T10:00:00Z' }, ctx, NOW)).toEqual({ ok: true });
    // a closure by anyone else has no owner window
    expect(releaseAvailability({ ...inside, closedReason: 'platform' }, ctx, NOW)).toEqual({ ok: true });
  });

  it('is refused for a member in a GDPR erasure and for a blocked e-mail — and only the blocked person’s own button is off for the latter', () => {
    expect(releaseAvailability(deleted(), { gdpr: 'pending', memberBlocked: false }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('GDPR') });
    expect(releaseAvailability(deleted(), { gdpr: null, memberBlocked: true }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('blocked list') });
    expect(releaseAvailability(deleted(), { gdpr: null, memberBlocked: false }, NOW)).toEqual({ ok: true });
  });
});

describe('ownerReopenable — the Prompt 602 flow, hosted in this tab', () => {
  it('only an account closed by its owner, inside the window', () => {
    expect(ownerReopenable(live({ closedAt: '2026-10-01T00:00:00Z', closedReason: 'owner', purgeAfter: '2026-10-31T00:00:00Z' }), NOW)).toBe(true);
    expect(ownerReopenable(live({ closedAt: '2026-10-01T00:00:00Z', closedReason: 'owner', purgeAfter: '2026-10-12T00:00:00Z' }), NOW)).toBe(false);
    expect(ownerReopenable(live({ closedAt: '2026-10-01T00:00:00Z', closedReason: 'platform', purgeAfter: '2026-10-31T00:00:00Z' }), NOW)).toBe(false);
    expect(ownerReopenable(deleted(), NOW)).toBe(false);
  });
});

describe('signInHint — "why can’t she get in?" (display; the door is SQL and is proved in the rehearsal)', () => {
  const eco = (live: boolean) => ({ name: 'ALEX trial', role: 'owner', status: 'active', live });
  const inv = (live: boolean) => ({ name: 'Invest green', role: 'member', live });

  it('deleted org: a live hat lets the person in through it; nothing else leaves them at the door', () => {
    expect(signInHint(deleted(), { blocked: false, hats: { ecosystem: [eco(true)], investor: [] } })).toBe('Signs in through Ecosystem — ALEX trial');
    expect(signInHint(deleted(), { blocked: false, hats: { ecosystem: [], investor: [inv(true)] } })).toBe('Signs in through Investor — Invest green');
    expect(signInHint(deleted(), { blocked: false, hats: NO_HATS })).toMatch(/^Locked out by this account/);
    // a hat that is not live does not count
    expect(signInHint(deleted(), { blocked: false, hats: { ecosystem: [eco(false)], investor: [inv(false)] } })).toMatch(/^Locked out/);
  });

  it('a suspension is a sanction on the person: it locks out whatever else they hold', () => {
    expect(signInHint(live({ moderationStatus: 'suspended', closedAt: 'x', closedReason: 'platform' }), { blocked: false, hats: { ecosystem: [eco(true)], investor: [] } })).toMatch(/^Locked out — the account is suspended/);
  });

  it('a blocked e-mail is blocked whatever else it holds', () => {
    expect(signInHint(deleted(), { blocked: true, hats: { ecosystem: [eco(true)], investor: [] } })).toMatch(/^E-mail on the blocked list/);
  });

  it('an owner-closed account traps like a deleted one; a closure by the platform does not lock anyone out', () => {
    const owner = live({ closedAt: 'x', closedReason: 'owner' });
    expect(signInHint(owner, { blocked: false, hats: NO_HATS })).toMatch(/^Locked out/);
    expect(signInHint(owner, { blocked: false, hats: { ecosystem: [eco(true)], investor: [] } })).toMatch(/^Signs in through/);
    expect(signInHint(live({ closedAt: 'x', closedReason: 'platform' }), { blocked: false, hats: NO_HATS })).toBe('This account does not lock them out');
  });

  it('liveHatNames lists only the live ones', () => {
    expect(liveHatNames({ ecosystem: [eco(true), eco(false)], investor: [inv(true)] })).toEqual(['Ecosystem — ALEX trial', 'Investor — Invest green']);
  });
});

describe('what the routes answer when the SQL refuses', () => {
  it('maps the database’s exception to a status, and passes its human sentence through', () => {
    expect(refusalStatus({ code: '42501', message: 'platform admin only' })).toBe(403);
    expect(refusalStatus({ code: 'PGRST202', message: 'Could not find the function' })).toBe(503);
    expect(refusalStatus({ code: 'P0001', message: 'a reason is required to reopen an account' })).toBe(400);
    expect(refusalStatus({ code: 'P0001', message: 'no org with that id' })).toBe(404);
    expect(refusalStatus({ code: 'P0001', message: 'that person is not a member of this account' })).toBe(404);
    expect(refusalStatus({ code: 'P0001', message: 'only a deleted account can be reopened (its status is active)' })).toBe(409);
    expect(refusalStatus({ code: 'P0001', message: 'a member of this account is in a GDPR erasure (pending or done): it cannot be reopened' })).toBe(409);
    expect(refusalStatus({ code: '08006', message: 'connection' })).toBe(500);
    expect(refusalMessage({ code: 'P0001', message: 'only a deleted account can be reopened (its status is active)' })).toBe('only a deleted account can be reopened (its status is active)');
    expect(refusalMessage({ code: '42501', message: 'platform admin only' })).toBe('Platform admin only.');
    expect(refusalMessage({ code: 'PGRST202', message: 'x' })).toContain('has not been applied');
  });

  it('asks for the same few characters of reason the owner reopen does', () => {
    expect(MIN_REASON_LENGTH).toBe(4);
  });
});
