// Prompt 923 (A) — the router after every sign-in, through the REAL route handler: every combination of what a person can be lands in the right area, the choice made on the login page and the area used last are
// honoured, the 28/10/2026 case (a founder who is also a firm member choosing "Investor") lands in the firm's workspace and not on the data-room dead end, an account with no area goes where it always went, and a signed-out
// visit goes back to the sign-in form (keeping the investor side and the "link failed → use the code" fall-back).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { RoleSignals } from '@/lib/role-decision';

const none: RoleSignals = { isPlatformAdmin: false, hasOpenFounderOrg: false, hasActiveIncubatorMembership: false, hasApprovedClaim: false, hasActiveInvestorMembership: false, hasAccessGrant: false, isAbluteTeamEmailConfirmed: false, hasPendingClaim: false };
const h = vi.hoisted(() => ({ user: null as null | { id: string; email: string; email_confirmed_at: string; user_metadata: Record<string, unknown> }, signals: {} as Record<string, boolean>, pendingInvite: false }));

vi.mock('@/lib/supabase-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  resolveRoleSignals: async () => ({ ...none, ...h.signals }),
}));
vi.mock('@/lib/incubator-pending-server', () => ({ hasPendingIncubatorMemberInvite: async () => h.pendingInvite }));

import { GET } from './route';

const signIn = (signals: Partial<RoleSignals>, meta: Record<string, unknown> = {}) => { h.user = { id: 'u1', email: 'alexandrameira.ablute@example.test', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: meta }; h.signals = signals as Record<string, boolean>; };
async function go(query = '', cookie?: string): Promise<{ status: number; to: string }> {
  const res = await GET(new NextRequest(`https://www.sherlockdeal.com/go${query}`, { headers: cookie ? { cookie } : {} }));
  const to = new URL(res.headers.get('location') ?? '', 'https://www.sherlockdeal.com');
  return { status: res.status, to: to.pathname + to.search };
}

beforeEach(() => { h.user = null; h.signals = {}; h.pendingInvite = false; });

describe('every combination of papers lands in the right area', () => {
  it.each<[string, Partial<RoleSignals>, string]>([
    ['only a founder', { hasOpenFounderOrg: true }, '/pipeline'],
    ['only a firm member', { hasActiveInvestorMembership: true }, '/portal'],
    ['only data rooms', { hasAccessGrant: true }, '/portal?tab=pipeline'],
    ['an approved claim', { hasApprovedClaim: true }, '/portal'],
    ['an ecosystem member', { hasActiveIncubatorMembership: true }, '/ecosystem'],
    ['a founder who is also a firm member (no choice made)', { hasOpenFounderOrg: true, hasActiveInvestorMembership: true }, '/pipeline'],
    ['a founder, a firm member and data rooms (no choice made)', { hasOpenFounderOrg: true, hasActiveInvestorMembership: true, hasAccessGrant: true }, '/pipeline'],
    ['a platform administrator', { isPlatformAdmin: true }, '/pipeline'],
  ])('%s → %s', async (_name, signals, expected) => {
    signIn(signals);
    expect(await go()).toEqual({ status: 307, to: expected });
  });
});

describe('the choice at the login, and the area used last', () => {
  it('THE 28/10 CASE: a founder who is also a firm member who chose "Investor" lands in the firm\'s workspace — not on an empty data-room page', async () => {
    signIn({ hasOpenFounderOrg: true, hasActiveInvestorMembership: true });
    expect(await go('?as=investor')).toEqual({ status: 307, to: '/portal' });
  });
  it('"Investor" with no firm goes to the data rooms; with a firm AND data rooms, to the firm (the rooms are in the menu)', async () => {
    signIn({ hasAccessGrant: true });
    expect((await go('?as=investor')).to).toBe('/portal?tab=pipeline');
    signIn({ hasActiveInvestorMembership: true, hasAccessGrant: true });
    expect((await go('?as=investor')).to).toBe('/portal');
  });
  it('"Startup" → the founder workspace when they have one; when they do not, what they have', async () => {
    signIn({ hasOpenFounderOrg: true, hasActiveInvestorMembership: true });
    expect((await go('?as=founder')).to).toBe('/pipeline');
    signIn({ hasActiveInvestorMembership: true });
    expect((await go('?as=founder')).to).toBe('/portal');
  });
  it('no choice: the area they used last (the cookie), while they still have it; a stale or forged value is ignored', async () => {
    signIn({ hasOpenFounderOrg: true, hasActiveInvestorMembership: true, hasAccessGrant: true });
    expect((await go('', 'sd_area=investor')).to).toBe('/portal');
    expect((await go('', 'sd_area=dataroom')).to).toBe('/portal?tab=pipeline');
    expect((await go('', 'sd_area=ecosystem')).to).toBe('/pipeline');             // they no longer have it: never a dead end
    expect((await go('', 'sd_area=../../etc')).to).toBe('/pipeline');
    expect((await go('?as=founder', 'sd_area=investor')).to).toBe('/pipeline');   // a choice at the login beats the last area
  });
});

describe('an account with no area, and the signed-out', () => {
  it('goes where it always went: a pending claim to its page, a pending ecosystem invitation to its page, nothing to the public page', async () => {
    signIn({ hasPendingClaim: true });
    expect((await go()).to).toBe('/claim/pending');
    signIn({}); h.pendingInvite = true;
    expect((await go()).to).toBe('/invite/incubator/member/pending');
    h.pendingInvite = false;
    expect((await go()).to).toBe('/');
  });
  it('signed out: back to the sign-in form, on the investor side when that is where they came from, and still offering the code after a link that failed', async () => {
    expect(await go()).toEqual({ status: 307, to: '/login' });
    expect((await go('?as=investor')).to).toBe('/login?as=investor');
    expect((await go('?as=investor&linkFailed=1')).to).toBe('/login?as=investor&linkFailed=1');
  });
});
