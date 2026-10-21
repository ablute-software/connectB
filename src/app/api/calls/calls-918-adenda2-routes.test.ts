// Prompt 918, Adenda 2 (A and B) — what the public link serves as the cover and the logo, and what it tells a person who is looking at a startup in Developer Viewer.
//   A. 20/10/2026, INNOV-ID: both pictures worked for about a minute after each upload and then answered 502 "unavailable" — Next's fetch cache kept answering the Storage call that mints the 60-second
//      address, so every request after the first minute fetched an EXPIRED address (Storage: 400 InvalidJWT "exp" claim). Here: the pictures come out as images, nothing says more than "unavailable" to the
//      browser, the LOG says the real reason, and the client every Calls route uses never lets the cache answer.
//   B. A platform account inside Developer Viewer opened the link and saw a dead end: the session route says who they are and what they are viewing.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string } | null;
let isDeveloper = false;
const created: { url: string; key: string; options: { global?: { fetch?: unknown } } }[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: { global?: { fetch?: unknown } }) => { created.push({ url, key, options }); return fakeCallsAdmin(db, storage); },
}));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    rpc: async (fn: string) => ({ data: fn === 'is_ablute_developer' ? isDeveloper : null }),
    from: (t: string) => fakeCallsAdmin(db, storage).from(t),
  }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { GET as publicCover } from './public/[token]/cover/route';
import { GET as publicLogo } from './public/[token]/logo/route';
import { GET as sessionGet } from './public/[token]/session/route';
import { callsAdminClient, noStoreFetch } from '@/lib/calls/admin-client';
import { mediaFailureLine } from '@/lib/calls/media-log';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const STARTUP = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'gtglGfNNOMTFflaNpU624g';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a-real-looking-png-body')]);
const COVER = `calls/${CALL}/cover-65563652b105.png`;
const LOGO = `calls/${CALL}/logo-6c2880453402.png`;
const get = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });
const publicRoute = (route: typeof publicCover) => route(get(`http://localhost/api/calls/public/${TOKEN}/x`), { params: { token: TOKEN } });

function seed(callOver: Record<string, unknown> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; created.length = 0; isDeveloper = false;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.calls.push({
    id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'INNOV-ID', description: 'Summary', status: 'open',
    opens_at: iso(-DAY), closes_at: iso(30 * DAY), timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR',
    link_token: TOKEN, config_version: 3, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', contact_email: null,
    cover_path: COVER, logo_path: LOGO, cover_updated_at: '2026-10-20T08:56:26.546Z', logo_updated_at: '2026-10-20T08:57:39.873Z', ...callOver,
  });
  db.tables.call_form_fields.push({ id: 'f0000000-0000-4000-8000-000000000001', call_id: CALL, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false });
  storage.objects.set(COVER, { bytes: new Uint8Array(PNG), contentType: 'image/png' });
  storage.objects.set(LOGO, { bytes: new Uint8Array(PNG), contentType: 'image/png' });
  currentUser = null;                                                                       // nobody is signed in: this is the link opened in a private window
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  seed();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Storage's address answers with the bytes held by the fake storage, like the real one for an address that has not expired.
  vi.stubGlobal('fetch', async (url: string) => {
    const path = decodeURIComponent(String(url).replace('https://storage.test/signed/', '').replace(/\?.*$/, ''));
    const o = storage.objects.get(path);
    return o ? new Response(Buffer.from(o.bytes), { status: 200, headers: { 'content-type': o.contentType ?? 'application/octet-stream' } }) : new Response('nope', { status: 404 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); errors.mockRestore(); });
const logged = (): Record<string, unknown>[] => (errors.mock.calls as unknown[][])
  .map((c): Record<string, unknown> => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return {}; } })
  .filter((l) => l.event === 'calls_media_unavailable');

describe('A. the pictures of a published call open without a session', () => {
  it('the cover and the logo answer 200 with the real image, to someone who is not signed in', async () => {
    for (const route of [publicCover, publicLogo]) {
      const r = await publicRoute(route);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(r.headers.get('content-type')).toMatch(/^image\//);
      expect(Buffer.from(await r.arrayBuffer()).equals(PNG)).toBe(true);
    }
    expect(logged()).toEqual([]);
  });

  it('they are served again a minute later and an hour later: nothing about a picture is remembered between requests', async () => {
    for (let i = 0; i < 3; i++) expect((await publicRoute(publicCover)).status).toBe(200);
    // the address is minted again for every request (Storage is asked each time), never reused
    let mints = 0;
    const real = fakeCallsAdmin(db, storage);
    expect(real).toBeTruthy();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { mints++; expect(init?.cache).toBe('no-store'); return new Response(Buffer.from(PNG), { status: 200, headers: { 'content-type': 'image/png' } }); });
    await publicRoute(publicCover); await publicRoute(publicLogo);
    expect(mints).toBe(2);
  });

  it('an address Storage has already let expire (400 InvalidJWT) answers 502 "unavailable" to the browser — and the log says exactly why', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ statusCode: '400', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' }), { status: 400 }));
    const r = await publicRoute(publicCover);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, reason: 'unavailable' });                    // nothing of Storage's words reaches the browser
    expect(logged()).toEqual([expect.objectContaining({
      where: 'public', kind: 'cover', callId: CALL, path: COVER, stage: 'upstream', response: 502, upstreamStatus: 400, reason: expect.stringContaining('InvalidJWT'),
    })]);
    expect(String(errors.mock.calls[0][0])).not.toContain('service-key-for-test');
  });

  it('an object that is not in Storage answers 404 and the log says the signing step failed; a network failure says "fetch"', async () => {
    storage.objects.delete(LOGO);
    const missing = await publicRoute(publicLogo);
    expect(missing.status).toBe(404);
    expect(logged()).toEqual([expect.objectContaining({ kind: 'logo', stage: 'sign', response: 404, reason: expect.stringMatching(/not found/i) })]);
    errors.mockClear();
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    expect((await publicRoute(publicCover)).status).toBe(502);
    expect(logged()).toEqual([expect.objectContaining({ kind: 'cover', stage: 'fetch', reason: 'fetch failed' })]);
  });

  it('a call that is not published, or has no picture, reveals nothing and logs nothing', async () => {
    seed({ status: 'draft' });
    expect((await publicRoute(publicCover)).status).toBe(404);
    seed({ cover_path: null });
    expect((await publicRoute(publicCover)).status).toBe(404);
    expect((await publicRoute(publicLogo)).status).toBe(200);
    expect(logged()).toEqual([]);
  });

  it('the log line carries the call and the path, never a person\'s data', () => {
    const line = mediaFailureLine({ where: 'editor', kind: 'logo', callId: CALL, path: LOGO }, { stage: 'upstream', response: 502, upstreamStatus: 400, message: 'x' });
    expect(Object.keys(line).sort()).toEqual(['callId', 'event', 'kind', 'path', 'reason', 'response', 'stage', 'upstreamStatus', 'where']);
  });
});

describe('A. the client every Calls route uses never lets the fetch cache answer', () => {
  it('callsAdminClient hands supabase-js a fetch that forces cache: no-store, keeping everything else of the request', async () => {
    created.length = 0;
    callsAdminClient('https://example.supabase.co', 'k');
    const fetchOf = created[0].options.global?.fetch as typeof fetch;
    expect(fetchOf).toBe(noStoreFetch);
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => { seen = init; return new Response('{}'); });
    await fetchOf('https://example.supabase.co/rest/v1/calls', { method: 'POST', headers: { a: 'b' }, body: 'x', cache: 'force-cache' });
    expect(seen).toMatchObject({ method: 'POST', headers: { a: 'b' }, body: 'x', cache: 'no-store' });   // even an explicit force-cache is overruled
  });

  it('the clients the real routes build (the public link, the editor) are made through it', async () => {
    created.length = 0;
    await publicRoute(publicCover);
    expect(created.length).toBeGreaterThan(0);
    for (const c of created) expect(c.options.global?.fetch, 'every client of the Calls routes').toBe(noStoreFetch);
  });
});

describe('B. a Developer Viewer session on the call\'s link', () => {
  const VIEWER_COOKIE = `${VIEWER_ORG_COOKIE}=${STARTUP}:2026-10-20T08:58:32.431Z`;
  const session = (headers: Record<string, string> = {}) => sessionGet(get(`http://localhost/api/calls/public/${TOKEN}/session`, headers), { params: { token: TOKEN } }).then(async (r) => ({ status: r.status, body: await r.json() }));

  beforeEach(() => {
    db.tables.orgs.push({ id: STARTUP, name: 'Mob2is' });
    currentUser = { id: 'dev', email: 'nunomarujo@ablute.pt' };
  });

  it('a verified viewer session says readOnly, who the person is and which startup they are looking at', async () => {
    isDeveloper = true;
    const r = await session({ cookie: VIEWER_COOKIE });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, authenticated: true, hasStartup: true, readOnly: true, email: 'nunomarujo@ablute.pt', startupName: 'Mob2is' });
  });

  it('the same cookie on an account that is NOT a developer is no viewer session at all (the cookie is only ever a hint)', async () => {
    isDeveloper = false;
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'dev', role: 'owner' });
    const r = await session({ cookie: VIEWER_COOKIE });
    expect(r.body.readOnly).toBe(false);
    expect(r.body.startupName).toBe('Mob2is');
  });

  it('without the cookie a developer who is also a member of a startup applies as a member (not read-only)', async () => {
    isDeveloper = true;
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'dev', role: 'owner' });
    expect((await session()).body).toMatchObject({ readOnly: false, startupName: 'Mob2is' });
  });
});
