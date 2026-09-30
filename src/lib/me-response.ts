// Pure response-shape builders for GET /api/me (src/app/api/me/route.ts),
// pulled out so the "an authenticated response must never carry
// verifyIdentity" rule is enforced structurally and is testable without
// spinning up the route itself — route.ts pulls in next/headers (via
// supabase-server.ts, which has `import 'server-only'`) plus ~20 capability
// checks, a live Supabase client and several DB reads, none of which a unit
// test should need to mock just to prove a response-shape property. This
// file has no server-only import and no next/headers dependency, so it's
// importable from a plain vitest test.
//
// dev-tooling context (see scripts/dev-verify.mjs and CLAUDE.md's
// "Verifying a change in the browser" §1): dev:verify passes the running
// server's own {cwd, sha, port} to the Next child process via the
// DEV_VERIFY_IDENTITY env var, so a verification session can confirm via
// /api/me that the tab it's driving really is this checkout. That value
// must reach ONLY the `authEnabled: false` (demo-mode) response — never an
// authenticated one, since in production authEnabled is always true and
// this whole field is dev-only. `parseDevVerifyIdentity` is called from
// `buildUnauthenticatedMeResponse` alone; the authenticated builders below
// never reference `process.env.DEV_VERIFY_IDENTITY` at all, so there is no
// code path — not even a set env var — through which they could leak it.
import type { Role } from './supabase';
import type { Hats, OrgMemberRole } from './supabase-server';
import type { Entitlements, PlanTier } from './plans';

export type MeCapabilities = Record<string, boolean>;

export interface DevVerifyIdentity {
  cwd: string;
  sha: string;
  port: number;
}

// Safe by construction: any malformed/missing value degrades to `null`
// rather than throwing, so a garbled env var can never crash the route.
export function parseDevVerifyIdentity(raw: string | undefined): DevVerifyIdentity | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).cwd === 'string' &&
      typeof (parsed as Record<string, unknown>).sha === 'string' &&
      typeof (parsed as Record<string, unknown>).port === 'number'
    ) {
      const p = parsed as { cwd: string; sha: string; port: number };
      return { cwd: p.cwd, sha: p.sha, port: p.port };
    }
  } catch {
    // malformed JSON — fall through to null
  }
  return null;
}

export interface UnauthenticatedMeResponse {
  authEnabled: false;
  user: null;
  role: 'none';
  capabilities: MeCapabilities;
  verifyIdentity: DevVerifyIdentity | null;
}

// The ONLY builder in this file allowed to read DEV_VERIFY_IDENTITY.
export function buildUnauthenticatedMeResponse(capabilities: MeCapabilities): UnauthenticatedMeResponse {
  return {
    authEnabled: false,
    user: null,
    role: 'none',
    capabilities,
    verifyIdentity: parseDevVerifyIdentity(process.env.DEV_VERIFY_IDENTITY),
  };
}

export interface AuthenticatedNoUserMeResponse {
  authEnabled: true;
  user: null;
  role: 'none';
  capabilities: MeCapabilities;
}

// authEnabled is true but no logged-in user was resolved from the session.
export function buildAuthenticatedNoUserResponse(capabilities: MeCapabilities): AuthenticatedNoUserMeResponse {
  return { authEnabled: true, user: null, role: 'none', capabilities };
}

export interface AuthenticatedMeResponse {
  authEnabled: true;
  user: { id: string; email: string | undefined };
  role: Role;
  // Prompt I-01 §B.4 — every workspace this account can open (hat switcher).
  hats: Hats;
  // Prompt I-01c §A.3 — landing signals for an account with no home yet.
  pendingIncubatorMemberInvite?: boolean;
  signupIntent?: string | null;
  orgRole: OrgMemberRole | null;
  plan: PlanTier;
  entitlements: Entitlements;
  capabilities: MeCapabilities;
  watson: { quota: number; used: number; remaining: number; resetAt: string } | null;
  reviewQuota: { quota: number; used: number; remaining: number; resetsAt: string } | null;
  viewer: { orgId: string; orgName: string | null } | null;
  pioneerBadge: boolean;
}

// Denylist, not allowlist: strips ONLY `verifyIdentity` (the one field that
// must never reach an authenticated response — see this file's own header)
// and passes every other field through untouched, including one route.ts
// starts sending tomorrow that this file doesn't know about yet. Generic
// over T (rather than a plain `fields: AuthenticatedMeResponse` parameter)
// so TypeScript infers T from the actual object literal route.ts passes —
// a caller adding a new field to that literal widens T to include it,
// rather than either tripping an excess-property error or (worse) silently
// losing the field the way the previous explicit-destructure-then-
// reconstruct version of this function did. Confirmed necessary the hard
// way, 30/09/2026: a sibling session's own feature branch added a new
// field to the authenticated response, and the old allowlist version
// dropped it at runtime with no type error and no visible failure — a
// structural-safety mechanism (built to stop one specific leak) had the
// side effect of silently breaking anything unrelated to that leak.
export function buildAuthenticatedMeResponse<T extends AuthenticatedMeResponse>(fields: T): T {
  const rest = { ...fields } as Record<string, unknown>;
  delete rest.verifyIdentity;
  return rest as T;
}
