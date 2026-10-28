// Prompt 923 (B) — accepting a seat invitation, pure rules over in-memory ports: a new account and an existing one without a firm join; one already in the firm takes no second seat; an account that belongs to another
// firm is refused with the sentence ONLY when the one-firm rule is on (it is OFF today: an account may belong to several firms); a refusal never spends the invitation and is remembered for the administrator;
// the link alone proves nothing — only the confirmed invited email accepts.
import { describe, expect, it } from 'vitest';
import { ONE_FIRM_PER_ACCOUNT, acceptSeatInvite, inviteDisplay, maskEmail, type InvitePorts, type InviteRecord } from './seat-invite-accept';

const FIRM = 'firm-qa';
const invite = (over: Partial<InviteRecord> = {}): InviteRecord => ({ id: 'inv-1', entityId: FIRM, firmName: 'ablute_ — Internal QA', email: 'sherlockdeal.com+aval1@gmail.com', status: 'open', acceptedUserId: null, failureReason: null, ...over });

interface World { invite: InviteRecord | null; firms: Record<string, { entityId: string; name: string }[]>; refusal: string | null; joinError: string | null; joined: { userId: string; name: string | null; jobRole: string | null }[]; failed: { reason: string; userId: string | null }[]; recorded: string[] }
function ports(w: World): InvitePorts {
  return {
    invite: async (t) => (t === 'tok' ? w.invite : null),
    activeFirms: async (u) => w.firms[u] ?? [],
    seatRefusal: async () => w.refusal,
    join: async ({ userId, name, jobRole }) => {
      if (w.joinError) return { ok: false, error: w.joinError };
      w.joined.push({ userId, name, jobRole }); w.firms[userId] = [...(w.firms[userId] ?? []), { entityId: FIRM, name: w.invite!.firmName }]; w.invite = { ...w.invite!, status: 'accepted', acceptedUserId: userId, failureReason: null }; return { ok: true };
    },
    fail: async (_i, reason, userId) => { w.failed.push({ reason, userId }); w.invite = { ...w.invite!, failureReason: reason }; },
    record: async (_i, event) => { w.recorded.push(event); },
  };
}
const world = (over: Partial<World> = {}): World => ({ invite: invite(), firms: {}, refusal: null, joinError: null, joined: [], failed: [], recorded: [], ...over });
const acct = (id: string, email = 'sherlockdeal.com+aval1@gmail.com', emailConfirmed = true) => ({ id, email, emailConfirmed });
const accept = (w: World, a = acct('u1'), extra: Partial<Parameters<typeof acceptSeatInvite>[1]> = {}) => acceptSeatInvite(ports(w), { token: 'tok', account: a, ...extra });

describe('who can accept, and what happens', () => {
  it('a NEW account (created by the code on the invitation page) joins with its name and role, and the invitation is accepted', async () => {
    const w = world();
    const r = await accept(w, acct('new-1'), { profile: { name: '  Aval One ', role: 'Analyst' }, needsProfile: true });
    expect(r).toEqual({ ok: true, firmName: 'ablute_ — Internal QA', entityId: FIRM, alreadyAccepted: false });
    expect(w.joined).toEqual([{ userId: 'new-1', name: 'Aval One', jobRole: 'Analyst' }]);
    expect(w.invite).toMatchObject({ status: 'accepted', acceptedUserId: 'new-1' });
    expect(w.recorded).toEqual(['invite_accepted']);
  });

  it('a new account that has not given its name and role yet is asked for them — nothing is spent', async () => {
    const w = world();
    expect(await accept(w, acct('new-1'), { needsProfile: true })).toMatchObject({ ok: false, status: 422, code: 'profile_required' });
    expect(await accept(w, acct('new-1'), { needsProfile: true, profile: { name: 'Aval', role: '' } })).toMatchObject({ code: 'profile_required' });
    expect(w.joined).toEqual([]); expect(w.failed).toEqual([]); expect(w.invite!.status).toBe('open');
  });

  it('an EXISTING account with no firm joins at once (its profile is known: nothing more is asked)', async () => {
    const w = world();
    expect(await accept(w, acct('old-1'))).toMatchObject({ ok: true, alreadyAccepted: false });
    expect(w.joined).toEqual([{ userId: 'old-1', name: null, jobRole: null }]);
  });

  it('an account already in THIS firm has nothing to join: the invitation is taken as accepted, with no second seat and no questions', async () => {
    const w = world({ firms: { 'old-1': [{ entityId: FIRM, name: 'ablute_ — Internal QA' }] }, refusal: 'This firm has no free seat right now.' });
    expect(await accept(w, acct('old-1'), { needsProfile: true, oneFirmPerAccount: true })).toMatchObject({ ok: true });
    expect(w.failed).toEqual([]);
  });

  it('the same account opening the page twice is fine (already accepted); another account finds it spent', async () => {
    const w = world({ invite: invite({ status: 'accepted', acceptedUserId: 'u1' }) });
    expect(await accept(w, acct('u1'))).toMatchObject({ ok: true, alreadyAccepted: true });
    expect(await accept(w, acct('u2'))).toMatchObject({ ok: false, status: 410, code: 'closed', error: 'This invitation has already been used.' });
  });
});

describe('the one-firm rule — OFF today, tested for the day Nuno turns it on', () => {
  it('today an account may belong to several firms: it joins this one as well', async () => {
    expect(ONE_FIRM_PER_ACCOUNT).toBe(false);
    const w = world({ firms: { 'old-1': [{ entityId: 'other', name: 'Portugal Ventures' }] } });
    expect(await accept(w, acct('old-1'), { oneFirmPerAccount: ONE_FIRM_PER_ACCOUNT })).toMatchObject({ ok: true });
    expect(w.firms['old-1'].map((f) => f.name)).toEqual(['Portugal Ventures', 'ablute_ — Internal QA']);
  });

  it('with the rule ON: "This account already belongs to «Firm». Ask the inviter to use a different email, or leave «Firm» first." — the invitation stays OPEN, is not spent, and the reason is kept for the administrator', async () => {
    const w = world({ firms: { 'old-1': [{ entityId: 'other', name: 'Portugal Ventures' }] } });
    const r = await accept(w, acct('old-1'), { oneFirmPerAccount: true });
    expect(r).toEqual({ ok: false, status: 409, code: 'other_firm', error: 'This account already belongs to «Portugal Ventures». Ask the inviter to use a different email, or leave «Portugal Ventures» first.' });
    expect(w.joined).toEqual([]);
    expect(w.invite).toMatchObject({ status: 'open', acceptedUserId: null, failureReason: r.ok ? '' : r.error });
    expect(w.failed).toHaveLength(1);
    expect(inviteDisplay(w.invite!)).toEqual({ state: 'failed', label: "Couldn't be accepted", reason: w.invite!.failureReason });
  });
});

describe('the link alone proves nothing', () => {
  it('an unknown token says nothing else; a cancelled invitation names the firm to ask', async () => {
    expect(await acceptSeatInvite(ports(world()), { token: 'nope', account: acct('u1') })).toMatchObject({ ok: false, status: 404, code: 'invalid' });
    expect(await accept(world({ invite: invite({ status: 'cancelled' }) }))).toMatchObject({ status: 410, code: 'cancelled', error: 'This invitation was cancelled. Ask ablute_ — Internal QA to send you a new one.' });
  });
  it('an account whose email is not CONFIRMED cannot accept; one signed in with ANOTHER address is told which address the invitation is for (masked) and what to do', async () => {
    const w = world();
    expect(await accept(w, acct('u1', 'sherlockdeal.com+aval1@gmail.com', false))).toMatchObject({ status: 403, code: 'unconfirmed' });
    const r = await accept(w, acct('u2', 'someone.else@example.com'));
    expect(r).toMatchObject({ ok: false, status: 403, code: 'wrong_account' });
    expect(r.ok ? '' : r.error).toBe('This invitation is for s••••@gmail.com. Sign out and open the link again with that address.'.replace('s••••', maskEmail('sherlockdeal.com+aval1@gmail.com').split('@')[0]));
    expect(r.ok ? '' : r.error).not.toContain('sherlockdeal.com+aval1');
    expect(w.joined).toEqual([]);
  });
  it('the email is compared whatever the case or the spaces', async () => {
    expect(await accept(world(), acct('u1', '  SherlockDeal.com+Aval1@Gmail.com '))).toMatchObject({ ok: true });
  });
});

describe("when the firm's own rules say no", () => {
  it('no free seat, or a plan that ended: the sentence, the invitation stays open and the reason is kept; a later success clears it', async () => {
    const w = world({ refusal: 'This firm no longer has a seat plan. Ask the inviter to send you a new invitation.' });
    const r = await accept(w);
    expect(r).toMatchObject({ ok: false, status: 409, code: 'seat_refused', error: 'This firm no longer has a seat plan. Ask the inviter to send you a new invitation.' });
    expect(w.invite).toMatchObject({ status: 'open', failureReason: 'This firm no longer has a seat plan. Ask the inviter to send you a new invitation.' });
    w.refusal = null;
    expect(await accept(w)).toMatchObject({ ok: true });
    expect(w.invite).toMatchObject({ status: 'accepted', failureReason: null });
  });
  it('a database refusal while joining is reported in words and kept too', async () => {
    const w = world({ joinError: 'We could not add you to the firm just now. Try again in a minute, or ask the inviter.' });
    expect(await accept(w)).toMatchObject({ ok: false, code: 'failed' });
    expect(w.failed[0].reason).toContain('We could not add you');
    expect(w.invite!.status).toBe('open');
  });
});

describe('what the administrator sees', () => {
  it('Open, Accepted, or "Couldn\'t be accepted" with the reason', () => {
    expect(inviteDisplay({ status: 'open', failureReason: null })).toEqual({ state: 'open', label: 'Open', reason: null });
    expect(inviteDisplay({ status: 'accepted', failureReason: null })).toEqual({ state: 'accepted', label: 'Accepted', reason: null });
    expect(inviteDisplay({ status: 'open', failureReason: 'No free seat.' })).toEqual({ state: 'failed', label: "Couldn't be accepted", reason: 'No free seat.' });
  });
});
