// Prompt 559 §A — the viewer cookie stopped being a credential.
//
// `sd_viewer_org_id` is an unsigned "<orgId>:<iso>" that anyone can write.
// Four routes read it and acted on the org id inside without ever asking
// whether the sending session is a developer, in two shapes:
//
//   matchdeal-firm   if (viewerOrgId !== entity.org_id) { ...membership... }
//                    → a matching forged cookie SKIPPED the check entirely
//   pipeline-unlock  let orgId = readViewerOrgId(req); if (!orgId) {...}
//   page-view        → the cookie took PRIORITY over the membership lookup,
//   heartbeat          redirecting a service-role read (and, in
//                      pipeline-unlock, a write) at an arbitrary org
//
// These tests pin the helper both routes now go through. The exploit itself
// isn't reproduced here on purpose: forging the cookie against a real
// session means driving production, and demo mode (dev:verify) has auth off,
// so there is no honest browser-level fixture for it — CLAUDE.md's rule 1.
// What is testable is the decision, and that is what this file holds.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as viewer from './developer-viewer';
import { authorizeViewedOrg, readVerifiedViewerOrgId, resolveViewedOrg, resolveViewedOrgId, VIEWER_ORG_COOKIE } from './developer-viewer';
import { fakeDb, fakeSession } from '../test/fake-supabase';

const ORG = '11111111-1111-1111-1111-111111111111';
const COOKIE = `${ORG}:2026-09-03T19:16:00.000Z`;

function reqWithCookie(value: string | null): Request {
  return new Request('https://example.test/api/whatever', {
    headers: value === null ? {} : { cookie: `${VIEWER_ORG_COOKIE}=${value}` },
  });
}

function sbWhere(isDeveloper: unknown) {
  const rpc = vi.fn(async () => ({ data: isDeveloper }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('readVerifiedViewerOrgId', () => {
  it('returns the org id when the session really is a developer', async () => {
    const { client, rpc } = sbWhere(true);
    await expect(readVerifiedViewerOrgId(client, reqWithCookie(COOKIE))).resolves.toBe(ORG);
    expect(rpc).toHaveBeenCalledWith('is_ablute_developer');
  });

  it('returns null for a forged cookie on a non-developer session', async () => {
    const { client } = sbWhere(false);
    await expect(readVerifiedViewerOrgId(client, reqWithCookie(COOKIE))).resolves.toBeNull();
  });

  it('returns null when the developer check itself fails to answer', async () => {
    // An rpc error yields { data: null }: fail closed, never "assume yes".
    const { client } = sbWhere(null);
    await expect(readVerifiedViewerOrgId(client, reqWithCookie(COOKIE))).resolves.toBeNull();
  });

  it('returns null with no cookie, without paying for the developer check', async () => {
    const { client, rpc } = sbWhere(true);
    await expect(readVerifiedViewerOrgId(client, reqWithCookie(null))).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null for a malformed cookie value', async () => {
    const { client } = sbWhere(true);
    await expect(readVerifiedViewerOrgId(client, reqWithCookie(ORG))).resolves.toBeNull();
  });

  it('never exports the raw org-id read, so a fifth caller cannot reintroduce the bug', () => {
    expect(Object.keys(viewer)).not.toContain('readViewerOrgId');
  });
});

describe('the two shapes the four routes used, against the verified read', () => {
  it('shape A: a forged cookie no longer skips the membership check', async () => {
    // matchdeal-firm: `if (viewerOrgId !== entity.org_id) { ...403... }`.
    const { client } = sbWhere(false);
    const viewerOrgId = await readVerifiedViewerOrgId(client, reqWithCookie(COOKIE));
    expect(viewerOrgId !== ORG).toBe(true); // the check runs, as it must
  });

  it('shape B: a forged cookie no longer outranks the membership lookup', async () => {
    // pipeline-unlock / page-view / heartbeat: `orgId = viewer ?? member`.
    const { client } = sbWhere(false);
    const memberOrgId = '22222222-2222-2222-2222-222222222222';
    const orgId = (await readVerifiedViewerOrgId(client, reqWithCookie(COOKIE))) ?? memberOrgId;
    expect(orgId).toBe(memberOrgId);
  });
});

// Prompt 902 — the one resolver every founder-side route now asks "which org is
// this request about?". The caller is always a member of ORG_A; the cookie, when
// present, names ORG_B.
describe('resolveViewedOrg / resolveViewedOrgId / authorizeViewedOrg', () => {
  const A = '0cdfcfc9-0000-0000-0000-00000000000a';
  const USER = 'dddddddd-0000-0000-0000-000000000001';
  const db = () => fakeDb({ org_members: [{ user_id: USER, org_id: A }] });
  const session = (isDeveloper: boolean) => fakeSession(db(), { userId: USER, isDeveloper });

  it('in a verified viewer session the answer is the viewed org, not the caller’s membership', async () => {
    await expect(resolveViewedOrg(session(true), reqWithCookie(COOKIE), USER)).resolves.toEqual({ orgId: ORG, viewer: true });
    await expect(resolveViewedOrgId(session(true), reqWithCookie(COOKIE), USER)).resolves.toBe(ORG);
  });

  it('with no cookie it is the caller’s own org', async () => {
    await expect(resolveViewedOrg(session(true), reqWithCookie(null), USER)).resolves.toEqual({ orgId: A, viewer: false });
  });

  it('a forged cookie on a non-developer session falls back to the caller’s own org, never the named one', async () => {
    await expect(resolveViewedOrg(session(false), reqWithCookie(COOKIE), USER)).resolves.toEqual({ orgId: A, viewer: false });
  });

  it('a user with no membership and no viewer session has no org', async () => {
    const sb = fakeSession(fakeDb({ org_members: [] }), { userId: USER, isDeveloper: false });
    await expect(resolveViewedOrg(sb, reqWithCookie(null), USER)).resolves.toEqual({ orgId: null, viewer: false });
  });

  it('authorizeViewedOrg: in the viewer only the viewed org is allowed — not the developer’s own, not a third', async () => {
    const third = '33333333-3333-3333-3333-333333333333';
    await expect(authorizeViewedOrg(session(true), reqWithCookie(COOKIE), USER, ORG)).resolves.toBe(true);
    await expect(authorizeViewedOrg(session(true), reqWithCookie(COOKIE), USER, A)).resolves.toBe(false);
    await expect(authorizeViewedOrg(session(true), reqWithCookie(COOKIE), USER, third)).resolves.toBe(false);
  });

  it('authorizeViewedOrg: outside the viewer it is plain membership of exactly the named org', async () => {
    await expect(authorizeViewedOrg(session(true), reqWithCookie(null), USER, A)).resolves.toBe(true);
    await expect(authorizeViewedOrg(session(true), reqWithCookie(null), USER, ORG)).resolves.toBe(false);
  });

  it('authorizeViewedOrg: a forged cookie on a non-developer session does not authorise the named org', async () => {
    await expect(authorizeViewedOrg(session(false), reqWithCookie(COOKIE), USER, ORG)).resolves.toBe(false);
  });
});
