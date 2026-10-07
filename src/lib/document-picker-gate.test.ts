// Prompt 742 §B.1 — /api/portal/document-picker answered ANY signed-in user who
// passed an orgId with that org's on_grant/due_diligence document NAMES (founder
// data — "Term sheet — Fundo X.pdf"): authenticated, then straight to the query,
// no relationship check in between. Found 26/09/2026, still open on main until
// this landed.
//
// The route runs for real over the in-memory table fake (src/test/fake-supabase.ts,
// the same one the viewer-org tests use). Only the two questions the gate asks
// are stubbed — "does this person hold an active grant to the org?" and "is the
// org in this investor's eligible set?" — so each test states the relationship
// it is about, and the assertions are on what came back, not on what was called.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb } from '@/test/fake-supabase';

const h = vi.hoisted(() => ({
  session: null as unknown,
  admin: null as unknown,
  grantedOrgIds: [] as string[],
  eligibleOrgIds: [] as string[],
  closedOrgIds: [] as string[],
  eligibilityCalls: 0,
}));

vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => h.session }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
vi.mock('@/lib/portal-access', () => ({ activeGrantOrgIds: async () => h.grantedOrgIds }));
vi.mock('@/lib/investor-pipeline', () => ({
  resolveInvestorOrgEligibility: async (_admin: unknown, _userId: string, _email: string, orgId: string) => {
    h.eligibilityCalls += 1;
    return { eligible: h.eligibleOrgIds.includes(orgId), decision: null, investorCatalogEntityId: null };
  },
}));
vi.mock('@/lib/org-closed', async () => {
  const { NextResponse } = await import('next/server');
  return {
    closedOrgGuard: async (_admin: unknown, orgId: string) =>
      h.closedOrgIds.includes(orgId) ? NextResponse.json({ ok: false, error: 'This startup is no longer available' }, { status: 410 }) : null,
  };
});

import { GET } from '@/app/api/portal/document-picker/route';

const ORG = 'aaaaaaaa-0000-0000-0000-00000000000a'; // the startup whose documents are asked about
const OTHER = 'bbbbbbbb-0000-0000-0000-00000000000b'; // some other startup
const USER = 'cccccccc-0000-0000-0000-00000000000c';
const EMAIL = 'someone@example.com';

const signedIn = () => ({ auth: { getUser: async () => ({ data: { user: { id: USER, email: EMAIL } } }) } });
const signedOut = () => ({ auth: { getUser: async () => ({ data: { user: null } }) } });
const ask = (orgId: string | null = ORG) =>
  GET(new Request(`http://localhost/api/portal/document-picker${orgId ? `?orgId=${orgId}` : ''}`));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
  h.session = signedIn();
  h.grantedOrgIds = [];
  h.eligibleOrgIds = [];
  h.closedOrgIds = [];
  h.eligibilityCalls = 0;
  h.admin = fakeAdmin(fakeDb({
    people: [],
    folders: [],
    access_grants: [],
    documents: [
      { id: 'd-open', org_id: ORG, name: 'Public one-pager.pdf', folder_id: null, visibility: 'open', kind: null },
      { id: 'd-grant', org_id: ORG, name: 'Financial model.xlsx', folder_id: null, visibility: 'on_grant', kind: null },
      { id: 'd-dd', org_id: ORG, name: 'Term sheet — Fundo X.pdf', folder_id: null, visibility: 'due_diligence', kind: null },
      { id: 'd-memo', org_id: ORG, name: 'Deal memo.pdf', folder_id: null, visibility: 'on_grant', kind: 'deal_memo' },
    ],
  }));
});

describe('document-picker — a caller with no relationship to the startup gets nothing (Prompt 742 §B.1)', () => {
  it('still refuses a caller who is not signed in', async () => {
    h.session = signedOut();
    expect((await ask()).status).toBe(401);
  });

  it('404s a signed-in user with no grant and no place in the org — and never names a document', async () => {
    const res = await ask();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found.' });
    expect(JSON.stringify(body)).not.toContain('Term sheet');
  });

  it('answers exactly as it does for an org that does not exist: nothing to tell the two apart', async () => {
    const real = await ask(ORG);
    const missing = await ask('dddddddd-0000-0000-0000-00000000000d');
    expect(missing.status).toBe(real.status);
    expect(await missing.json()).toEqual(await real.json());
  });

  it("a grant to ANOTHER org opens nothing here", async () => {
    h.grantedOrgIds = [OTHER];
    expect((await ask()).status).toBe(404);
  });

  it('being eligible for ANOTHER org opens nothing here either', async () => {
    h.eligibleOrgIds = [OTHER];
    expect((await ask()).status).toBe(404);
  });
});

describe('document-picker — the people it exists for keep working (Prompt 742 §B.1)', () => {
  it('an investor whose pipeline holds the startup gets the locked documents, name + level only', async () => {
    h.eligibleOrgIds = [ORG];
    const res = await ask();
    expect(res.status).toBe(200);
    const { documents } = await res.json();
    expect(documents).toEqual([
      { id: 'd-grant', name: 'Financial model.xlsx', visibility: 'on_grant' },
      { id: 'd-dd', name: 'Term sheet — Fundo X.pdf', visibility: 'due_diligence' },
    ]);
  });

  it('a grantee with an active grant to this org gets the list too — without paying for the heavy eligibility read', async () => {
    h.grantedOrgIds = [ORG];
    const res = await ask();
    expect(res.status).toBe(200);
    expect((await res.json()).documents).toHaveLength(2);
    expect(h.eligibilityCalls).toBe(0);
  });

  it('never lists the open documents, a locked deal memo, or anything beyond id/name/visibility', async () => {
    h.eligibleOrgIds = [ORG];
    const { documents } = await (await ask()).json();
    const names = documents.map((d: { name: string }) => d.name);
    expect(names).not.toContain('Public one-pager.pdf');
    expect(names).not.toContain('Deal memo.pdf');
    for (const d of documents) expect(Object.keys(d).sort()).toEqual(['id', 'name', 'visibility']);
  });
});

describe('document-picker — a closed org does not become an oracle (Prompt 742 §B.1 × Prompt 556 §C)', () => {
  it('a caller with no relationship gets the same 404 whether or not the org is closed', async () => {
    h.closedOrgIds = [ORG];
    const closed = await ask();
    h.closedOrgIds = [];
    const open = await ask();
    expect(closed.status).toBe(404);
    expect(open.status).toBe(404);
    expect(await closed.json()).toEqual(await open.json());
  });

  it('a caller who DOES have a relationship still learns the startup is gone (410)', async () => {
    h.closedOrgIds = [ORG];
    h.eligibleOrgIds = [ORG];
    expect((await ask()).status).toBe(410);
  });
});
