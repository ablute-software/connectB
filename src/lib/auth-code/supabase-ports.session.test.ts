// Prompt 911 (fix, 13/10/2026) — "after the code, the person has a valid session and reaches the destination".
//
// Production, sherlockdeal.com+codigo2 at 14:30:47–48 UTC: /verify 200, then PUT /admin/users/<id> (the typed password), then
// GET /user -> 403 "Session not found". The ADMIN password update ends the user's sessions, so the person landed on the home page
// signed out. This test models that behaviour of Supabase Auth (admin password update revokes sessions; the session's own
// updateUser does not) and runs the REAL ports and the REAL verify service over it: after the right code the session must still be
// valid, the password applied, and the password must NOT have been applied before the code.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyRegistrationCode } from './service';

interface FakeUser { id: string; email: string; confirmed: boolean; password: string; meta: Record<string, unknown> }

function fakeAuth() {
  const users = new Map<string, FakeUser>();
  const sessions = new Set<string>();
  const log: string[] = [];
  let n = 0;
  const codes = new Map<string, string>(); // email -> the live code

  const cookieClient = () => {
    const state: { session: string | null } = { session: null };
    return {
      state,
      auth: {
        async verifyOtp({ email, token }: { email: string; token: string; type: string }) {
          log.push('verifyOtp');
          const u = [...users.values()].find((x) => x.email === email);
          if (!u || codes.get(email) !== token) return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
          u.confirmed = true; codes.delete(email);
          const sid = `session-${++n}`; sessions.add(sid); state.session = sid;
          return { data: { user: u, session: { id: sid } }, error: null };
        },
        // The session's own client: acts on the signed-in user and keeps the session alive.
        async updateUser({ password, data }: { password?: string; data?: Record<string, unknown> }) {
          log.push('updateUser');
          if (!state.session || !sessions.has(state.session)) return { error: { message: 'Auth session missing!' } };
          const u = [...users.values()].find((x) => x.confirmed)!;
          if (password) u.password = password;
          if (data) u.meta = { ...u.meta, ...data };
          return { error: null };
        },
        async getUser() {
          if (!state.session || !sessions.has(state.session)) return { data: { user: null }, error: { message: 'Session not found' } };
          return { data: { user: [...users.values()].find((x) => x.confirmed)! }, error: null };
        },
      },
    };
  };

  const admin = {
    rpc: async (name: string) => {
      if (name === 'auth_code_ip_hit') return { data: false, error: null };
      if (name === 'auth_code_reserve_attempt') return { data: { allowed: true, attempts_left: 4 }, error: null };
      return { data: null, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: users.get(id) } }),
        // Observed in production on 13/10/2026: the admin password update ends the user's sessions.
        updateUserById: async (id: string, attrs: { password?: string; user_metadata?: Record<string, unknown> }) => {
          log.push('admin.updateUserById');
          const u = users.get(id)!;
          if (attrs.password) { u.password = attrs.password; sessions.clear(); }
          if (attrs.user_metadata) u.meta = { ...u.meta, ...attrs.user_metadata };
          return { error: null };
        },
      },
    },
  };

  return {
    users, sessions, log, codes, admin, cookieClient,
    register(email: string, code: string) {
      const id = `user-${users.size + 1}`;
      users.set(id, { id, email, confirmed: false, password: 'throwaway', meta: { password_set: false } });
      codes.set(email, code);
      return id;
    },
  };
}

let world: ReturnType<typeof fakeAuth>;
let cookies: ReturnType<ReturnType<typeof fakeAuth>['cookieClient']>;

vi.mock('@/lib/supabase-server', () => ({ serverClient: async () => cookies }));
vi.mock('@/lib/resend', () => ({ sendTransactionalEmail: vi.fn(), transactionalTemplate: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

import { makeSupabasePorts } from './supabase-ports';

const PASSWORD = 'Correct-Horse-9!';
const EMPTY = { fullName: '', startup: '', country: '', role: '' };
const FOUNDER = { fullName: 'Ana Test', startup: 'zz-test-startup', country: 'Portugal', role: 'CEO' };

beforeEach(() => { world = fakeAuth(); cookies = world.cookieClient(); });

describe('after the right code the person is signed in, and stays signed in', () => {
  it('the typed password is applied with the session\'s own client: the session survives and getUser() works (the failure of 13/10)', async () => {
    const id = world.register('ana@example.com', '123456');
    const ports = makeSupabasePorts(world.admin as never);
    const r = await verifyRegistrationCode(ports, { email: 'ana@example.com', code: '123456', password: PASSWORD, profile: FOUNDER, ip: '1.1.1.1' });

    expect(r).toMatchObject({ status: 200, body: { ok: true, userId: id, passwordSet: true } });
    // The session created by the code is still valid: what /api/provision-org and /api/invite/*/accept rely on.
    expect(world.sessions.size).toBe(1);
    const who = await cookies.auth.getUser();
    expect(who.error).toBeNull();
    expect(who.data.user?.id).toBe(id);
    // The password was applied, and the account is marked as having one.
    expect(world.users.get(id)).toMatchObject({ password: PASSWORD, meta: { password_set: true, full_name: 'Ana Test', org_name: 'zz-test-startup' } });
    // The admin API was never used to change the password.
    expect(world.log).not.toContain('admin.updateUserById');
  });

  it('the password is applied only AFTER the code: a wrong code changes nothing and opens no session', async () => {
    const id = world.register('ana@example.com', '123456');
    const ports = makeSupabasePorts(world.admin as never);
    const r = await verifyRegistrationCode(ports, { email: 'ana@example.com', code: '000000', password: PASSWORD, profile: FOUNDER, ip: '1.1.1.1' });
    expect(r.status).toBe(400);
    expect(world.users.get(id)?.password).toBe('throwaway');
    expect(world.sessions.size).toBe(0);
    expect(world.log).not.toContain('updateUser');
  });

  it('an invite (no profile) keeps the session too, and does not blank what the account already has', async () => {
    const id = world.register('invitee@example.com', '654321');
    world.users.get(id)!.meta = { password_set: false, signup_intent: 'incubator_member', full_name: 'Keeps Me' };
    const ports = makeSupabasePorts(world.admin as never);
    const r = await verifyRegistrationCode(ports, { email: 'invitee@example.com', code: '654321', password: PASSWORD, profile: EMPTY, ip: '1.1.1.1', strict: false });
    expect(r).toMatchObject({ status: 200, body: { ok: true, passwordSet: true } });
    expect(world.sessions.size).toBe(1);
    expect((await cookies.auth.getUser()).data.user?.id).toBe(id);
    expect(world.users.get(id)?.meta).toMatchObject({ password_set: true, signup_intent: 'incubator_member', full_name: 'Keeps Me' });
  });

  it('if applying the password fails, the code was still right: the session is kept and the person is told, not signed out', async () => {
    world.register('ana@example.com', '123456');
    cookies.auth.updateUser = async () => ({ error: { message: 'Password is too weak for this project.' } });
    const ports = makeSupabasePorts(world.admin as never);
    const r = await verifyRegistrationCode(ports, { email: 'ana@example.com', code: '123456', password: PASSWORD, profile: FOUNDER, ip: '1.1.1.1' });
    expect(r).toMatchObject({ status: 200, body: { ok: true, passwordSet: false, warning: 'Password is too weak for this project.' } });
    expect(world.sessions.size).toBe(1);
  });
});

describe('why the admin route was wrong (the model of what production showed)', () => {
  it('an admin password update ends the user\'s sessions: this is what signed people out', async () => {
    const id = world.register('ana@example.com', '123456');
    await cookies.auth.verifyOtp({ email: 'ana@example.com', token: '123456', type: 'signup' });
    expect(world.sessions.size).toBe(1);
    await world.admin.auth.admin.updateUserById(id, { password: PASSWORD });
    expect(world.sessions.size).toBe(0);
    expect((await cookies.auth.getUser()).error?.message).toBe('Session not found');
  });
});
