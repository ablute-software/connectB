// Prompt 904 §C.1 — the proof, screen by screen, over the real route handlers and an in-memory database.
//
// The world (fixtures named zz-test-*, as CLAUDE.md asks of anything that models a real org):
//
//   zz-test-A   has ONE of each thing the 12/10 report found inside Insignals: a document, a support
//               ticket, a market thesis, an incubator relationship, a network contact — plus the other
//               rows the screens need. Its developer member is DEV_A.
//   zz-test-B   is empty. Its developer member is DEV_B.
//
// Three scenarios per screen, because a test that only asserts "no leak" passes for a route that is simply
// broken:
//
//   control   DEV_A, no viewer cookie           → sees A's marker (the route works and the fixture reaches it)
//   no leak   DEV_A, viewer cookie → B (empty)  → NOT A's marker. This is the bug, as reported.
//   inverse   DEV_B, viewer cookie → A          → A's marker (the viewer shows what the founder sees)
//
// And one sweep over EVERY route file: each write handler wrapped by the viewer wrapper answers 403
// viewer_read_only in a viewer session, runs nothing, and leaves the database exactly as it was.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer-shape';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown }));

vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
vi.mock('@/lib/account-security-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/account-security-server')>()),
  serviceAdmin: () => h.admin,
}));

const ORG_A = 'a0a0a0a0-0000-4000-8000-00000000000a'; // zz-test-A — has the data
const ORG_B = 'b0b0b0b0-0000-4000-8000-00000000000b'; // zz-test-B — empty
const ORG_C = 'c0c0c0c0-0000-4000-8000-00000000000c'; // zz-test-A-contact — A's network contact
const DEV_A = 'dddddddd-0000-4000-8000-00000000000a';
const DEV_B = 'dddddddd-0000-4000-8000-00000000000b';
const ENTERED = '2026-10-12T10:00:00.000Z';
const MARK = 'zz-test-A-';

const cookieFor = (org: string) => `${VIEWER_ORG_COOKIE}=${org}:${ENTERED}`;

function world(): FakeDb {
  const db = fakeDb({
    orgs: [
      { id: ORG_A, name: 'zz-test-A', plan: 'garage', ai_credits_used_this_period: 17, ai_credits_reset_at: '2099-01-01T00:00:00Z', is_test: false, is_internal: false,
        one_liner: 'zz-test-A-one-liner', sectors: ['health'], stage: 'seed', country: 'PT', pioneer_badge: false },
      { id: ORG_B, name: 'zz-test-B', plan: 'idea', ai_credits_used_this_period: 3, ai_credits_reset_at: '2099-01-01T00:00:00Z', is_test: false, is_internal: false, sectors: [], pioneer_badge: false },
      { id: ORG_C, name: `${MARK}contact`, plan: 'idea' },
    ],
    org_members: [
      { user_id: DEV_A, org_id: ORG_A, role: 'admin' },
      { user_id: DEV_B, org_id: ORG_B, role: 'admin' },
    ],
    documents: [{ id: 'doc-A', org_id: ORG_A, name: `${MARK}document.pdf`, folder_id: null, visibility: 'org', created_at: '2026-10-01T00:00:00Z' }],
    support_tickets: [{
      id: 'ticket-A', org_id: ORG_A, user_id: 'user-A', email: 'a@example.test', category: 'question', subject: `${MARK}ticket`, message: 'hello',
      status: 'open', created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-01T00:00:00Z', requester_last_read_at: null,
    }],
    support_ticket_events: [],
    org_market_thesis: [{ org_id: ORG_A, version: 3, primary_user: `${MARK}thesis`, economic_buyer: null, beachhead: null }],
    org_market_hypotheses: [],
    incubator_relationships: [{
      id: 'rel-A', org_id: ORG_A, incubator_id: 'inc-1', cohort_id: null, status: 'ended', sharing_level: 1, public_badge: false,
      started_at: '2026-01-01T00:00:00Z', graduated_at: null, ended_at: '2026-10-01T00:00:00Z', ended_by: 'incubator', end_reason: null,
    }],
    incubators: [{ id: 'inc-1', name: `${MARK}incubator`, logo_url: null, kind: 'accelerator', related_catalog_entity_id: null }],
    incubator_cohorts: [],
    incubator_access_log: [],
    network_actors: [{ id: 'actor-A', org_id: ORG_A, matchdeal_profile_id: null }, { id: 'actor-C', org_id: ORG_C, matchdeal_profile_id: null }],
    network_connections: [{ id: 'conn-1', actor_low_id: 'actor-A', actor_high_id: 'actor-C', status: 'active', blocked_by_actor_id: null, origin_context: null, created_at: '2026-10-01T00:00:00Z' }],
    network_invites: [],
    company_badges: [{ id: 'badge-A', org_id: ORG_A, name: `${MARK}badge`, description: null, year: 2025, created_at: '2026-10-01T00:00:00Z' }],
    company_media: [{ id: 'media-A', org_id: ORG_A, kind: 'photo', category: 'company', caption: `${MARK}media`, storage_path: 'p', external_url: null, malware_scan_status: 'clean', sort_order: 0, created_at: '2026-10-01T00:00:00Z' }],
    company_people: [{ id: 'person-A', org_id: ORG_A, full_name: `${MARK}person`, title: 'CEO', is_founder: true, commitment: 'full_time', sort_order: 0 }],
    company_role_coverage: [],
    org_questions: [],
    portal_questions: [{ id: 'q-A', org_id: ORG_A, question: `${MARK}question`, status: 'open', created_at: '2026-10-01T00:00:00Z' }],
    round_updates: [{ id: 'upd-A', org_id: ORG_A, body: `${MARK}update`, created_at: '2026-10-01T00:00:00Z', target: 'all' }],
    investor_soft_commits: [],
    email_send_log: [{ id: 'mail-A', org_id: ORG_A, kind: 'guest_invite', recipient: `${MARK}recipient@example.test`, status: 'sent', subject: 's', provider_error: null, from_address_used: null, created_at: '2026-10-01T00:00:00Z' }],
    plans: [{ key: 'garage', monthly_ai_credits: 100 }, { key: 'idea', monthly_ai_credits: 10 }],
    plan_overrides: [],
    ai_actions: [{ key: 'compose_outreach', credit_cost: 1, enabled: true }],
    admin_audit_log: [],
    matchdeal_pairings: [{ id: 'pair-A', org_id: ORG_A, kind: 'startup', device_id: `${MARK}device`, paired_at: '2026-10-01T00:00:00Z', last_seen_at: null, status: 'active' }],
    matchdeal_pairing_tokens: [],
    platform_admins: [{ user_id: DEV_A }, { user_id: DEV_B }],
    app_events: [],
    usage_sessions: [],
    product_events: [],
  });
  db.authUsers = { [DEV_A]: { email: `${MARK}dev@example.test` }, [DEV_B]: { email: 'zz-test-B-dev@example.test' } };
  db.rpc = {
    // the real function answers for the SESSION's own orgs; the fixture mirrors that for a member
    founder_incubator_relationships: () => [{ relationship_id: 'rel-A', incubator_name: `${MARK}incubator` }],
    founder_incubator_access_log: () => [],
  };
  return db;
}

let db: FakeDb;

/** Every write except the viewer_read audit row — the one write a viewer READ is supposed to make. */
const dataWrites = () => db.writes.filter((w) => w.table !== 'admin_audit_log');
const auditRows = () => db.writes.filter((w) => w.table === 'admin_audit_log');

function actAs(user: string, isDeveloper = true) {
  h.session = fakeSession(db, { userId: user, isDeveloper, email: `${user}@ablute.pt` });
  h.admin = fakeAdmin(db);
}

function call(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Request {
  return new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  db = world();
  actAs(DEV_A);
});

interface Screen { screen: string; name: string; load: () => Promise<Record<string, unknown>>; url: string; marker: string }

/** The reads behind the screens of the 12/10 report. */
const SCREENS: Screen[] = [
  { screen: 'Messages › Support', name: 'support/my-tickets', load: () => import('@/app/api/support/my-tickets/route'), url: '/api/support/my-tickets', marker: `${MARK}ticket` },
  { screen: 'Market › Market thesis', name: 'market-thesis', load: () => import('@/app/api/market-thesis/route'), url: '/api/market-thesis', marker: `${MARK}thesis` },
  { screen: 'Programmes & organisations', name: 'founder/incubator-programs', load: () => import('@/app/api/founder/incubator-programs/route'), url: '/api/founder/incubator-programs', marker: `${MARK}incubator` },
  { screen: 'My Network', name: 'network', load: () => import('@/app/api/network/route'), url: '/api/network', marker: `${MARK}contact` },
  { screen: 'Data room › Documents', name: 'market-data/vault-documents', load: () => import('@/app/api/market-data/vault-documents/route'), url: '/api/market-data/vault-documents', marker: `${MARK}document` },
  { screen: 'App access', name: 'team/members', load: () => import('@/app/api/team/members/route'), url: '/api/team/members', marker: `${MARK}dev@example.test` },
  { screen: 'About › Badges', name: 'company-badges', load: () => import('@/app/api/company-badges/route'), url: '/api/company-badges', marker: `${MARK}badge` },
  { screen: 'About › Photos & media', name: 'company-media', load: () => import('@/app/api/company-media/route'), url: '/api/company-media', marker: `${MARK}media` },
  { screen: 'About › Team', name: 'company/team-composition', load: () => import('@/app/api/company/team-composition/route'), url: '/api/company/team-composition', marker: `${MARK}person` },
  { screen: 'Data room › Email status', name: 'data-room/email-status', load: () => import('@/app/api/data-room/email-status/route'), url: '/api/data-room/email-status', marker: `${MARK}recipient` },
  { screen: 'MatchDeal › Devices', name: 'matchdeal/pairing/status', load: () => import('@/app/api/matchdeal/pairing/status/route'), url: '/api/matchdeal/pairing/status?kind=startup', marker: `${MARK}device` },
];

async function bodyOf(res: Response): Promise<string> {
  return JSON.stringify(await res.json().catch(() => null));
}

describe.each(SCREENS)('$screen — $name', ({ load, url, marker }) => {
  it('control: a member of A, outside a viewer session, sees A (the route works and the fixture reaches it)', async () => {
    actAs(DEV_A);
    const mod = await load();
    const res = await (mod.GET as (r: Request, c?: unknown) => Promise<Response>)(call('GET', url));
    expect(await bodyOf(res)).toContain(marker);
  });

  it('no leak: the same member, viewing the EMPTY org B, sees nothing of A', async () => {
    actAs(DEV_A);
    const mod = await load();
    const res = await (mod.GET as (r: Request, c?: unknown) => Promise<Response>)(call('GET', url, { cookie: cookieFor(ORG_B) }));
    expect(await bodyOf(res)).not.toContain(MARK);
    expect(dataWrites(), 'a read in a viewer session must not write').toEqual([]);
    expect(auditRows().map((w) => (w.values as { action: string }).action)).toEqual(['viewer_read']);
  });

  it('inverse: a member of B viewing A sees A\'s item', async () => {
    actAs(DEV_B);
    const mod = await load();
    const res = await (mod.GET as (r: Request, c?: unknown) => Promise<Response>)(call('GET', url, { cookie: cookieFor(ORG_A) }));
    expect(await bodyOf(res)).toContain(marker);
    expect(dataWrites(), 'a read in a viewer session must not write').toEqual([]);
  });
});

describe('the shell\'s own reads follow the viewed org', () => {
  it('/api/ai-credits/status shows the VIEWED org\'s wallet and writes nothing', async () => {
    actAs(DEV_A);
    const { GET } = await import('@/app/api/ai-credits/status/route');
    const res = await GET(new NextRequest('https://example.test/api/ai-credits/status?action=compose_outreach', { headers: { cookie: cookieFor(ORG_B) } }));
    const body = await res.json() as { ok: boolean; status: { used: number; monthlyLimit: number } };
    expect(body.ok).toBe(true);
    expect(body.status.used).toBe(3); // B's, not A's 17
    expect(body.status.monthlyLimit).toBe(10); // B's plan 'idea', not A's 'garage'
    expect(dataWrites()).toEqual([]);
    expect(db.rpcCalls?.map((c) => c.name).filter((n) => n !== 'is_ablute_developer')).toEqual([]);
  });

  it('/api/me describes the viewed org (plan, role) — and reports no role in it', async () => {
    actAs(DEV_A);
    const { GET } = await import('@/app/api/me/route');
    const res = await GET(call('GET', '/api/me', { cookie: cookieFor(ORG_B) }) as never);
    const body = await res.json() as { orgRole: string | null; plan: string; viewer: { orgId: string } | null };
    expect(body.plan).toBe('idea'); // B's plan, not the developer's own org's 'garage'
    expect(body.orgRole).toBeNull();
    expect(body.viewer?.orgId).toBe(ORG_B);
  });

  it('telemetry from a viewer session counts for nobody', async () => {
    actAs(DEV_A);
    const pageView = await import('@/app/api/events/page-view/route');
    const heartbeat = await import('@/app/api/usage/heartbeat/route');
    const productEvents = await import('@/app/api/product-events/route');
    for (const mod of [pageView, heartbeat, productEvents]) {
      const res = await (mod.POST as (r: Request) => Promise<Response>)(call('POST', '/api/x', { cookie: cookieFor(ORG_B), body: { route: '/pipeline', event: 'dossier_opened', sessionId: 's', context: 'crm' } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: 'viewer' });
    }
    expect(db.writes).toEqual([]);
  });
});

describe('hidden writes behind a GET are closed in a viewer session', () => {
  it('market-data/research GET does not run a model, write, or debit credits', async () => {
    actAs(DEV_B);
    db.tables.org_market_hypotheses = [{ id: 'hyp-A', org_id: ORG_A, status: 'active', label: 'h', definition: 'd' }];
    db.tables.company_claims = [{ id: 'c', org_id: ORG_A, status: 'accepted', category: 'solucao' }];
    const { GET } = await import('@/app/api/market-data/research/route');
    const res = await GET(call('GET', '/api/market-data/research?hypothesisId=hyp-A', { cookie: cookieFor(ORG_A) }));
    expect(res.status).toBeLessThan(500);
    expect(db.writes.filter((w) => w.table === 'market_research_items')).toEqual([]);
    expect(db.rpcCalls?.some((c) => c.name === 'charge_ai_action')).toBe(false);
  });

  it('support/my-tickets/[id] does not mark the requester\'s ticket as read', async () => {
    actAs(DEV_B);
    const { GET } = await import('@/app/api/support/my-tickets/[id]/route');
    const res = await GET(call('GET', '/api/support/my-tickets/ticket-A', { cookie: cookieFor(ORG_A) }), { params: { id: 'ticket-A' } });
    expect((await bodyOf(res))).toContain(`${MARK}ticket`);
    expect(db.writes.filter((w) => w.table === 'support_tickets')).toEqual([]);
  });

  it('pipeline-unlock GET does not raise the viewed org\'s catalog quota or stamp its profile', async () => {
    actAs(DEV_B);
    const { GET } = await import('@/app/api/pipeline-unlock/route');
    await GET(call('GET', '/api/pipeline-unlock', { cookie: cookieFor(ORG_A) }) as never);
    expect(db.writes.filter((w) => w.table === 'orgs')).toEqual([]);
  });
});

// ─── the sweep: every wrapped write route, in a viewer session ──────────────────────────────────────────────
const API = path.resolve(__dirname, '../app/api');
const importers = import.meta.glob('../app/api/**/route.ts') as Record<string, () => Promise<Record<string, unknown>>>;

describe('every write handler behind the viewer wrapper refuses a viewer session', () => {
  const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
  const entries = Object.entries(importers).map(([key, load]) => {
    const file = path.resolve(__dirname, key);
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const route = path.relative(API, file).split(path.sep).join('/').replace(/\/?route\.ts$/, '');
    const wrapped = WRITE.filter((m) => new RegExp(`^export const ${m}\\s*=\\s*(withActingOrg|withoutViewer)\\(`, 'm').test(src))
      .filter((m) => !new RegExp(`^export const ${m}\\s*=\\s*withActingOrg\\([\\s\\S]*?ignoreInViewer\\s*:\\s*true`, 'm').test(src));
    return { route, load, methods: wrapped };
  }).filter((e) => e.methods.length > 0);

  it('there are well over a hundred of them', () => {
    expect(entries.flatMap((e) => e.methods).length).toBeGreaterThan(120);
  });

  it('each answers 403 viewer_read_only, runs nothing, and leaves the database exactly as it was', async () => {
    actAs(DEV_A);
    const refused: string[] = [];
    const failures: string[] = [];
    for (const { route, load, methods } of entries) {
      let mod: Record<string, unknown>;
      try { mod = await load(); } catch (e) { failures.push(`${route}: cannot import (${(e as Error).message.slice(0, 80)})`); continue; }
      for (const method of methods) {
        const handler = mod[method] as (r: Request, c?: unknown) => Promise<Response>;
        const res = await handler(call(method, `/api/${route.replace(/\[(\w+)\]/g, 'x')}`, { cookie: cookieFor(ORG_B), body: {} }), { params: { id: 'x', token: 'x', userId: 'x', threadId: 'x' } });
        const body = await res.json().catch(() => null) as { error?: string } | null;
        if (res.status !== 403 || body?.error !== 'viewer_read_only') failures.push(`${method} ${route} → ${res.status} ${JSON.stringify(body)?.slice(0, 80)}`);
        else refused.push(`${method} ${route}`);
      }
    }
    expect(failures).toEqual([]);
    expect(refused.length).toBeGreaterThan(120);
    expect(db.writes).toEqual([]);
    expect((db.rpcCalls ?? []).filter((c) => c.name !== 'is_ablute_developer')).toEqual([]);
  }, 180_000);

  it('the routes that act on the caller\'s own account refuse even a READ in a viewer session', async () => {
    actAs(DEV_A);
    const failures: string[] = [];
    for (const key of ['account/security', 'commitments/status', 'auth-code/status', 'oauth/google/status', 'promo/status', 'promo/referrals']) {
      const load = importers[`../app/api/${key}/route.ts`];
      const mod = await load();
      const res = await (mod.GET as (r: Request) => Promise<Response>)(call('GET', `/api/${key}`, { cookie: cookieFor(ORG_B) }));
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (res.status !== 403 || body?.error !== 'viewer_read_only') failures.push(`GET ${key} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
