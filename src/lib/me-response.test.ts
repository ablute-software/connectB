import { describe, it, expect, afterEach } from 'vitest';
import {
  parseDevVerifyIdentity,
  buildUnauthenticatedMeResponse,
  buildAuthenticatedNoUserResponse,
  buildAuthenticatedMeResponse,
  type AuthenticatedMeResponse,
} from './me-response';

// GET /api/me (src/app/api/me/route.ts) itself has no test — it pulls in
// next/headers via supabase-server.ts (`import 'server-only'`), a live
// Supabase client and ~20 capability checks, none of which this repo's
// existing test conventions mock (grep src/app/api for *.test.* returns
// nothing; every other route in this codebase is verified by browser/
// integration testing instead of a unit test, per CLAUDE.md's dev:verify
// section). What DOES need a real, executable guarantee is narrower and
// security-relevant: the dev-only `verifyIdentity` field (see
// scripts/dev-verify.mjs) must never leak into an authenticated response,
// since in production authEnabled is always true. route.ts was refactored
// to build its three response shapes through the functions tested below,
// so this test exercises the exact code the route calls, not a
// reimplementation of it.
const DEV_VERIFY_IDENTITY_ENV_KEY = 'DEV_VERIFY_IDENTITY';

afterEach(() => {
  delete process.env[DEV_VERIFY_IDENTITY_ENV_KEY];
});

describe('parseDevVerifyIdentity', () => {
  it('parses a well-formed identity', () => {
    const raw = JSON.stringify({ cwd: '/repo/worktree', sha: 'abc1234', port: 3001 });
    expect(parseDevVerifyIdentity(raw)).toEqual({ cwd: '/repo/worktree', sha: 'abc1234', port: 3001 });
  });

  it('returns null when the env var is unset', () => {
    expect(parseDevVerifyIdentity(undefined)).toBeNull();
  });

  it('degrades to null on malformed JSON instead of throwing', () => {
    expect(() => parseDevVerifyIdentity('{not json')).not.toThrow();
    expect(parseDevVerifyIdentity('{not json')).toBeNull();
  });

  it('degrades to null when required fields are missing or mistyped', () => {
    expect(parseDevVerifyIdentity(JSON.stringify({ cwd: '/x' }))).toBeNull();
    expect(parseDevVerifyIdentity(JSON.stringify({ cwd: '/x', sha: 'abc', port: '3000' }))).toBeNull();
    expect(parseDevVerifyIdentity(JSON.stringify(null))).toBeNull();
    expect(parseDevVerifyIdentity(JSON.stringify('a string'))).toBeNull();
  });
});

describe('buildUnauthenticatedMeResponse (the demo-mode early return)', () => {
  it('attaches a parsed verifyIdentity when DEV_VERIFY_IDENTITY is set', () => {
    process.env[DEV_VERIFY_IDENTITY_ENV_KEY] = JSON.stringify({ cwd: '/repo', sha: 'deadbee', port: 3002 });
    const result = buildUnauthenticatedMeResponse({ ai: true });
    expect(result).toEqual({
      authEnabled: false,
      user: null,
      role: 'none',
      capabilities: { ai: true },
      verifyIdentity: { cwd: '/repo', sha: 'deadbee', port: 3002 },
    });
  });

  it('carries verifyIdentity: null when the env var is absent', () => {
    const result = buildUnauthenticatedMeResponse({ ai: false });
    expect(result.verifyIdentity).toBeNull();
    expect('verifyIdentity' in result).toBe(true);
  });
});

describe('authenticated response builders never carry verifyIdentity', () => {
  it('buildAuthenticatedNoUserResponse omits verifyIdentity even when DEV_VERIFY_IDENTITY is set', () => {
    process.env[DEV_VERIFY_IDENTITY_ENV_KEY] = JSON.stringify({ cwd: '/repo', sha: 'deadbee', port: 3000 });
    const result = buildAuthenticatedNoUserResponse({ ai: true });
    expect(result).toEqual({ authEnabled: true, user: null, role: 'none', capabilities: { ai: true } });
    expect('verifyIdentity' in result).toBe(false);
    expect(Object.keys(result).sort()).toEqual(['authEnabled', 'capabilities', 'role', 'user']);
  });

  it('buildAuthenticatedMeResponse (the full logged-in shape) omits verifyIdentity even when DEV_VERIFY_IDENTITY is set', () => {
    process.env[DEV_VERIFY_IDENTITY_ENV_KEY] = JSON.stringify({ cwd: '/repo', sha: 'deadbee', port: 3000 });
    const fields: AuthenticatedMeResponse = {
      authEnabled: true,
      user: { id: 'user-1', email: 'founder@example.com' },
      role: 'founder',
      orgRole: 'owner',
      plan: 'garage',
      entitlements: {
        aiComposer: true,
        // The exact Entitlements shape isn't this test's concern — only
        // that whatever shape route.ts passes through comes back unchanged
        // and without an added verifyIdentity key. Cast covers fields this
        // test doesn't care about.
      } as unknown as AuthenticatedMeResponse['entitlements'],
      capabilities: { ai: true },
      watson: null,
      reviewQuota: null,
      viewer: null,
      pioneerBadge: false,
    };
    const result = buildAuthenticatedMeResponse(fields);
    expect('verifyIdentity' in result).toBe(false);
    expect(Object.keys(result).sort()).toEqual(
      ['authEnabled', 'capabilities', 'entitlements', 'orgRole', 'pioneerBadge', 'plan', 'reviewQuota', 'role', 'user', 'viewer', 'watson'].sort(),
    );
    // Round-trips every field it was given, unmodified.
    expect(result).toEqual(fields);
  });

  it('JSON.stringify of either authenticated shape never contains the string "verifyIdentity"', () => {
    process.env[DEV_VERIFY_IDENTITY_ENV_KEY] = JSON.stringify({ cwd: '/repo', sha: 'deadbee', port: 3000 });
    const noUser = buildAuthenticatedNoUserResponse({ ai: true });
    const fullUser = buildAuthenticatedMeResponse({
      authEnabled: true,
      user: { id: 'user-1', email: undefined },
      role: 'investor',
      orgRole: null,
      plan: 'idea',
      entitlements: {} as unknown as AuthenticatedMeResponse['entitlements'],
      capabilities: {},
      watson: null,
      reviewQuota: null,
      viewer: null,
      pioneerBadge: false,
    });
    expect(JSON.stringify(noUser)).not.toContain('verifyIdentity');
    expect(JSON.stringify(fullUser)).not.toContain('verifyIdentity');
  });
});
