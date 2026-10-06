// Prompt 902 — Developer Viewer must show EXACTLY the viewed org's data on the
// founder-side routes behind the Vault and the shell: no more (the developer's
// own org leaking into another org's screen) and no less.
//
// The report that opened this: in the viewer over ABOUT FOOD, Vault › Document
// requests listed two requests from nunomarujo@ablute.pt. Both rows belong to
// ablute_ — the developer's OWN org. /api/founder/document-requests resolved
// the org from the caller's org_members row, while the folders / documents /
// grants beside it load through the store, which reads /api/me's viewer.orgId.
// Two orgs on one screen.
//
// Every test below states the same fixture: the caller is a MEMBER of org A and
// carries a viewer cookie for org B (ABOUT FOOD). The expectation is always B.
// Routes run for real over an in-memory table fake (src/test/fake-supabase.ts)
// that filters on `.eq('org_id', …)`, so "only B's rows" is asserted on the rows
// that came back, not on which method happened to be called.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown }));

vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => h.session }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
vi.mock('@/lib/account-security-server', () => ({ serviceAdmin: () => h.admin }));
vi.mock('@/lib/document-request-capability', () => ({
  accessRequestItemsAvailable: async () => true,
  documentRequestItemTypeAvailable: async () => false,
}));
vi.mock('@/lib/investor-interest-notify-capability', () => ({ investorInterestNotifyAvailable: async () => true }));

import { GET as documentRequestsGet, POST as documentRequestsPost } from '@/app/api/founder/document-requests/route';
import { GET as accessRequestsGet } from '@/app/api/data-room/access-requests/route';
import { GET as accessLogGet } from '@/app/api/account/access-log/route';
import { GET as vaultDocumentsGet } from '@/app/api/market-data/vault-documents/route';
import { GET as investorInterestGet, POST as investorInterestPost } from '@/app/api/founder/investor-interest/route';
import { GET as investorDecisionsGet } from '@/app/api/org/investor-decisions/route';
import { GET as investorFeedbackGet } from '@/app/api/founder/investor-feedback/route';

const DEV = 'dddddddd-0000-0000-0000-000000000001';
const ORG_A = '0cdfcfc9-0000-0000-0000-00000000000a'; // ablute_ — the developer's own org
const ORG_B = 'b0b0b0b0-0000-0000-0000-00000000000b'; // ABOUT FOOD — the org being viewed
const FOUNDER_B = 'ffffffff-0000-0000-0000-00000000000b';

const COOKIE_B = `${VIEWER_ORG_COOKIE}=${ORG_B}:2026-10-06T10:00:00.000Z`;

function req(url: string, opts: { cookie?: string; method?: string; body?: unknown } = {}): Request {
  return new Request(`https://example.test${url}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    org_members: [
      { user_id: DEV, org_id: ORG_A },
      { user_id: FOUNDER_B, org_id: ORG_B },
    ],
    access_requests: [
      { id: 'reqA1', org_id: ORG_A, kind: 'document', status: 'pending', requested_email: 'nunomarujo@ablute.pt', message: null, requested_at: '2026-08-28T10:00:00Z', founder_seen_at: null, person_id: null, folder_ids: [], document_ids: [] },
      { id: 'reqA2', org_id: ORG_A, kind: 'access', status: 'pending', requested_email: 'nunomarujo@ablute.pt', message: null, requested_at: '2026-09-15T10:00:00Z', founder_seen_at: null, person_id: null, folder_ids: [], document_ids: [] },
      { id: 'reqB1', org_id: ORG_B, kind: 'document', status: 'pending', requested_email: 'investor@fund.test', message: null, requested_at: '2026-10-01T10:00:00Z', founder_seen_at: null, person_id: null, folder_ids: [], document_ids: [] },
      { id: 'reqB2', org_id: ORG_B, kind: 'access', status: 'pending', requested_email: 'other@fund.test', message: null, requested_at: '2026-10-02T10:00:00Z', founder_seen_at: null, person_id: null, folder_ids: [], document_ids: [] },
    ],
    access_request_items: [
      { id: 'itemA1', request_id: 'reqA1', document_id: null, requested_label: 'A deck', status: 'pending', fulfilled_document_id: null, promised_for: null, decline_reason: null, resolution_note: null },
      { id: 'itemB1', request_id: 'reqB1', document_id: null, requested_label: 'B cap table', status: 'pending', fulfilled_document_id: null, promised_for: null, decline_reason: null, resolution_note: null },
    ],
    people: [], folders: [{ id: 'fA', org_id: ORG_A, name: 'A folder' }, { id: 'fB', org_id: ORG_B, name: 'B folder' }],
    documents: [
      { id: 'dA', org_id: ORG_A, name: 'A secret.pdf', folder_id: 'fA' },
      { id: 'dB', org_id: ORG_B, name: 'B menu.pdf', folder_id: 'fB' },
    ],
    document_views: [
      { id: 'vA', org_id: ORG_A, document_id: 'dA', viewer_email: 'a-viewer@x.test', viewed_at: '2026-10-01T00:00:00Z', seconds: 5, pages: 1 },
      { id: 'vB', org_id: ORG_B, document_id: 'dB', viewer_email: 'b-viewer@x.test', viewed_at: '2026-10-02T00:00:00Z', seconds: 9, pages: 2 },
    ],
    investor_relationship_decisions: [
      { id: 'decA', org_id: ORG_A, investor_catalog_entity_id: 'catA', decision: 'interested', reason_detail: null, decided_at: '2026-09-01T00:00:00Z', seen_at: null },
      { id: 'decB', org_id: ORG_B, investor_catalog_entity_id: 'catB', decision: 'interested', reason_detail: null, decided_at: '2026-09-02T00:00:00Z', seen_at: null },
    ],
    catalog_entities: [{ id: 'catA', name: 'nunomarujo@gmail.com — Individual investor' }, { id: 'catB', name: 'Fund B' }],
    investor_feedback_shares: [
      { id: 'fbA', org_id: ORG_A, investor_name: 'Fund A', kind: 'insight', text: 'A note', shared_at: '2026-09-01T00:00:00Z' },
      { id: 'fbB', org_id: ORG_B, investor_name: 'Fund B', kind: 'insight', text: 'B note', shared_at: '2026-09-02T00:00:00Z' },
    ],
    catalog_deliveries: [],
  };
}

let db: FakeDb;

/** The developer: member of A, signed in, is_ablute_developer = `isDeveloper`. */
function asDeveloper(isDeveloper = true) {
  h.session = fakeSession(db, { userId: DEV, isDeveloper });
  h.admin = fakeAdmin(db);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  db = fakeDb(tables());
});

async function ids(res: Response, key = 'requests'): Promise<string[]> {
  const body = await res.json() as Record<string, { id: string }[]>;
  return (body[key] ?? []).map((r) => r.id).sort();
}

describe('GET /api/founder/document-requests — the reported bug', () => {
  it('in the viewer over B it lists only B’s requests, never the developer’s own org’s', async () => {
    asDeveloper();
    const res = await documentRequestsGet(req('/api/founder/document-requests', { cookie: COOKIE_B }));
    expect(await ids(res)).toEqual(['reqB1']);
  });

  it('an org with no requests shows an empty list, not the developer’s org’s', async () => {
    asDeveloper();
    db.tables.access_requests = db.tables.access_requests.filter((r) => r.org_id !== ORG_B);
    const res = await documentRequestsGet(req('/api/founder/document-requests', { cookie: COOKIE_B }));
    expect(await ids(res)).toEqual([]);
  });

  it('a request id from the developer’s own org cannot be read from inside the viewer over B', async () => {
    asDeveloper();
    const res = await documentRequestsGet(req('/api/founder/document-requests?id=reqA1', { cookie: COOKIE_B }));
    expect(await ids(res)).toEqual([]);
  });

  it('the popup feed (?unseen=1) is empty in the viewer: the developer neither sees nor consumes it', async () => {
    asDeveloper();
    const res = await documentRequestsGet(req('/api/founder/document-requests?unseen=1', { cookie: COOKIE_B }));
    expect(await ids(res)).toEqual([]);
  });

  it('outside the viewer a founder still gets their own org’s requests (and the popup feed)', async () => {
    asDeveloper();
    const own = await documentRequestsGet(req('/api/founder/document-requests'));
    expect(await ids(own)).toEqual(['reqA1']);
    const unseen = await documentRequestsGet(req('/api/founder/document-requests?unseen=1'));
    expect(await ids(unseen)).toEqual(['reqA1']);
  });

  it('a forged viewer cookie on a non-developer session does not redirect the read at B', async () => {
    asDeveloper(false);
    const res = await documentRequestsGet(req('/api/founder/document-requests', { cookie: COOKIE_B }));
    expect(await ids(res)).toEqual(['reqA1']);
  });
});

describe('POST /api/founder/document-requests (mark seen)', () => {
  it('is refused in the viewer and writes nothing', async () => {
    asDeveloper();
    const res = await documentRequestsPost(req('/api/founder/document-requests', { cookie: COOKIE_B, method: 'POST', body: { requestId: 'reqA1' } }));
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it('still marks the founder’s own org’s request seen outside the viewer', async () => {
    asDeveloper();
    const res = await documentRequestsPost(req('/api/founder/document-requests', { method: 'POST', body: { requestId: 'reqA1' } }));
    expect(res.status).toBe(200);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: 'access_requests', op: 'update' });
    expect(db.writes[0].eqs).toContainEqual(['org_id', ORG_A]);
  });
});

describe('GET /api/data-room/access-requests (“Pending requests”)', () => {
  const url = (orgId: string) => `/api/data-room/access-requests?orgId=${orgId}`;

  it('in the viewer over B, naming B returns B’s pending access requests', async () => {
    asDeveloper();
    const res = await accessRequestsGet(req(url(ORG_B), { cookie: COOKIE_B }));
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual(['reqB2']);
  });

  it('in the viewer over B, naming the developer’s own org A is refused', async () => {
    asDeveloper();
    const res = await accessRequestsGet(req(url(ORG_A), { cookie: COOKIE_B }));
    expect(res.status).toBe(403);
  });

  it('outside the viewer a member reads their own org, and is refused another', async () => {
    asDeveloper();
    expect(await ids(await accessRequestsGet(req(url(ORG_A))))).toEqual(['reqA2']);
    expect((await accessRequestsGet(req(url(ORG_B)))).status).toBe(403);
  });

  it('a forged cookie on a non-developer session is not a way into B', async () => {
    asDeveloper(false);
    expect((await accessRequestsGet(req(url(ORG_B), { cookie: COOKIE_B }))).status).toBe(403);
  });
});

describe('GET /api/account/access-log (document views)', () => {
  it('in the viewer over B it lists B’s views only', async () => {
    asDeveloper();
    const res = await accessLogGet(req('/api/account/access-log', { cookie: COOKIE_B }));
    const body = await res.json() as { views: { id: string; documentName: string }[] };
    expect(body.views.map((v) => v.id)).toEqual(['vB']);
    expect(body.views[0].documentName).toBe('B menu.pdf');
  });

  it('outside the viewer a founder sees their own org’s views', async () => {
    asDeveloper();
    const body = await (await accessLogGet(req('/api/account/access-log'))).json() as { views: { id: string }[] };
    expect(body.views.map((v) => v.id)).toEqual(['vA']);
  });
});

describe('GET /api/market-data/vault-documents', () => {
  it('in the viewer over B it lists B’s documents only', async () => {
    asDeveloper();
    const body = await (await vaultDocumentsGet(req('/api/market-data/vault-documents', { cookie: COOKIE_B }))).json() as { documents: { id: string }[] };
    expect(body.documents.map((d) => d.id)).toEqual(['dB']);
  });
});

describe('/api/founder/investor-interest', () => {
  it('the “in conversation” feed (?all=1) in the viewer over B is B’s decisions only', async () => {
    asDeveloper();
    const body = await (await investorInterestGet(req('/api/founder/investor-interest?all=1', { cookie: COOKIE_B }))).json() as { items: { catalogEntityId: string }[] };
    expect(body.items.map((i) => i.catalogEntityId)).toEqual(['catB']);
  });

  it('the popup feed is empty in the viewer', async () => {
    asDeveloper();
    const body = await (await investorInterestGet(req('/api/founder/investor-interest', { cookie: COOKIE_B }))).json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('marking seen is refused in the viewer and writes nothing', async () => {
    asDeveloper();
    const res = await investorInterestPost(req('/api/founder/investor-interest', { cookie: COOKIE_B, method: 'POST', body: { catalogEntityId: 'catA' } }));
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });
});

// Reported right after the first fix shipped to review: "a demonstração de
// interesse de nunomarujo@gmail.com ainda lá está". That investor (a test
// account of the developer's own) expressed interest in ablute_ — the
// developer's org — and the Company tab's "Investor decisions" card
// (/api/org/investor-decisions) listed it under ABOUT FOOD, which has no
// decisions at all. That route was on this prompt's own "found, not touched"
// list; it should not have been.
describe('GET /api/org/investor-decisions — the “Interested” card', () => {
  async function names(res: Response): Promise<string[]> {
    const body = await res.json() as { decisions: { id: string; investorName: string }[] };
    return body.decisions.map((d) => d.id);
  }

  it('in the viewer over B it lists B’s decisions only — never the developer’s own org’s “Interested”', async () => {
    asDeveloper();
    expect(await names(await investorDecisionsGet(req('/api/org/investor-decisions', { cookie: COOKIE_B })))).toEqual(['decB']);
  });

  it('an org with no decisions (ABOUT FOOD in production) shows none, not the developer’s org’s', async () => {
    asDeveloper();
    db.tables.investor_relationship_decisions = db.tables.investor_relationship_decisions.filter((d) => d.org_id !== ORG_B);
    const res = await investorDecisionsGet(req('/api/org/investor-decisions', { cookie: COOKIE_B }));
    expect(await names(res)).toEqual([]);
  });

  it('outside the viewer a founder sees their own org’s decisions, with the investor’s name', async () => {
    asDeveloper();
    const res = await investorDecisionsGet(req('/api/org/investor-decisions'));
    const body = await res.json() as { decisions: { id: string; investorName: string }[] };
    expect(body.decisions).toEqual([expect.objectContaining({ id: 'decA', investorName: 'nunomarujo@gmail.com — Individual investor' })]);
  });

  it('a forged viewer cookie on a non-developer session does not redirect the read at B', async () => {
    asDeveloper(false);
    expect(await names(await investorDecisionsGet(req('/api/org/investor-decisions', { cookie: COOKIE_B })))).toEqual(['decA']);
  });
});

describe('GET /api/founder/investor-feedback', () => {
  it('in the viewer over B it lists B’s shared feedback only', async () => {
    asDeveloper();
    const body = await (await investorFeedbackGet(req('/api/founder/investor-feedback', { cookie: COOKIE_B }))).json() as { shares: { id: string }[] };
    expect(body.shares.map((x) => x.id)).toEqual(['fbB']);
  });
});

// The routes whose whole viewer-side change is "refuse writes" or "swap the
// org resolver" and that would need heavyweight fixtures (email, deal threads,
// grants graph) to run for real. For those, pin the shape so a future edit
// cannot quietly put the old lookup back: no unfiltered caller-membership
// lookup on a read, and assertNotViewer on every mutation.
describe('source guard — the routes this prompt changed keep the viewed-org resolution', () => {
  const api = path.resolve(__dirname, '../app/api');
  const read = (rel: string) => readFileSync(path.join(api, rel, 'route.ts'), 'utf8');

  // A caller-membership lookup with no org filter: the exact line that caused this.
  const CALLER_MEMBERSHIP = /from\('org_members'\)\s*\.select\('org_id'\)\s*\.eq\('user_id',\s*(?:user\.id|userId)\)\s*\.maybeSingle\(\)/;

  const READERS = [
    'founder/document-requests', 'founder/investor-interest', 'founder/interest-level-requests',
    'founder/messages', 'founder/messages/eligible', 'founder/messages/[threadId]',
    'data-room/recipient-identities', 'data-room/access-requests', 'account/access-log',
    'market-data/vault-documents',
    'org/investor-decisions', 'founder/watches', 'founder/investor-feedback', 'founder/competitor-investments',
    'pipeline/suspended-investors', 'org/watson-investor-digest',
  ];
  for (const rel of READERS) {
    it(`${rel} resolves its org through the viewer-aware helper`, () => {
      const src = read(rel);
      expect(src).toMatch(/from '@\/lib\/developer-viewer'/);
      expect(src).not.toMatch(CALLER_MEMBERSHIP);
    });
  }

  const MUTATORS = [
    'founder/document-requests', 'founder/investor-interest', 'founder/messages', 'founder/messages/[threadId]',
    'data-room/access-requests/[id]/action', 'data-room/access-notify',
  ];
  for (const rel of MUTATORS) {
    it(`${rel} refuses a viewer session before any write`, () => {
      expect(read(rel)).toMatch(/assertNotViewer\(sb, req\)/);
    });
  }

  it('the investor digest never regenerates (an AI call + a write on a GET) from a viewer session', () => {
    const src = read('org/watson-investor-digest');
    expect(src).toMatch(/if \(viewer && !existing\)/);
    expect(src).toMatch(/if \(!isStale \|\| viewer\)/);
  });

  it('the two message GETs do not clear the founder’s unread flag from a viewer session', () => {
    for (const rel of ['founder/messages', 'founder/messages/[threadId]']) {
      expect(read(rel)).toMatch(/if \(!viewer\) await markThreadRead/);
    }
  });
});
