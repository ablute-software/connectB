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
import { readVerifiedViewerOrgId, VIEWER_ORG_COOKIE } from './developer-viewer';

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
