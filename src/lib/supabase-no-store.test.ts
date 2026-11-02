// Service-role clients that must not be answered by Next's fetch cache: the helper does what it says, and no GET-only route goes around it.
// Why the guard is shaped like this is in supabase-no-store.ts (what marks a route handler dynamic in Next 14.2.35, read from its source).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNoStoreClient, noStoreFetch } from './supabase-no-store';

const SRC = `${process.cwd()}/src`;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const stripComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');

describe('createNoStoreClient', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const json = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

  it('forces cache: no-store on a REST request and keeps the caller\'s own init', async () => {
    const spy = vi.fn(async () => json());
    vi.stubGlobal('fetch', spy);
    const sb = createNoStoreClient('http://localhost:54321', 'service-key', { auth: { persistSession: false } });
    await sb.from('org_invitations').select('email').eq('token', 'abc');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/rest/v1/org_invitations');
    expect(init.cache).toBe('no-store');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('forces it on an auth-admin request too (supabase-js hands the same fetch to GoTrue)', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ users: [], aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', spy);
    const sb = createNoStoreClient('http://localhost:54321', 'service-key', { auth: { persistSession: false } });
    await sb.auth.admin.listUsers();
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls as unknown as [string, RequestInit][]) expect(call[1].cache).toBe('no-store');
  });

  it('passes the other options through (extra global headers survive)', async () => {
    const spy = vi.fn(async () => json());
    vi.stubGlobal('fetch', spy);
    const sb = createNoStoreClient('http://localhost:54321', 'service-key', { auth: { persistSession: false }, global: { headers: { 'x-probe': '1' } } });
    await sb.from('plans').select('key');
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('x-probe')).toBe('1');
    expect(init.cache).toBe('no-store');
  });

  it('noStoreFetch overrides a cache mode the caller asked for', async () => {
    const spy = vi.fn(async () => json());
    vi.stubGlobal('fetch', spy);
    await noStoreFetch('http://localhost/x', { cache: 'force-cache' });
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].cache).toBe('no-store');
  });
});

// ---- the guard ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A route handler file that exports POST/DELETE/PATCH/OPTIONS is dynamic for every request it serves, its GET included. A GET-only file is not, unless a session is
// read first (serverClient() / requirePlatformAdmin(), which calls it / cookies() / headers() from next/headers). `dynamic = 'force-dynamic'` and reading `req` do NOT count. So a GET-only route with a bare
// service-role createClient must either build its client with createNoStoreClient / a no-store fetch, export `fetchCache = 'force-no-store'`, or read a session before it.
type RouteVerdict = 'ok' | 'bare-client-before-any-session';

function judgeRoute(source: string): RouteVerdict {
  const code = stripComments(source);
  const calls = [...code.matchAll(/\bcreateClient\s*\(/g)];
  const bare = calls.filter((m) => !/no-store|noStoreFetch/.test(code.slice(m.index, (m.index ?? 0) + 400)));
  if (bare.length === 0) return 'ok';
  if (/export\s+(async\s+)?(function|const)\s+(POST|DELETE|PATCH|OPTIONS)\b|export\s*\{[^}]*\b(POST|DELETE|PATCH|OPTIONS)\b/.test(code)) return 'ok';
  if (/export const fetchCache\s*=\s*'(force-no-store|default-no-store)'/.test(code)) return 'ok';
  const first = bare[0].index ?? 0;
  if (/\b(serverClient|requirePlatformAdmin|cookies|headers)\s*\(/.test(code.slice(0, first))) return 'ok';
  return 'bare-client-before-any-session';
}

describe('judgeRoute (the instrument can show the failure it looks for)', () => {
  const head = "import { createClient } from '@supabase/supabase-js';\n";
  it('flags a GET-only route that reads only its request before a bare client', () => {
    const src = `${head}export const dynamic = 'force-dynamic';\nexport async function GET(req: Request) { const t = new URL(req.url).searchParams.get('t'); const admin = createClient(u, k, { auth: { persistSession: false } }); }`;
    expect(judgeRoute(src)).toBe('bare-client-before-any-session');
  });
  it('flags a GET() with no argument', () => {
    expect(judgeRoute(`${head}export async function GET() { const admin = createClient(u, k); }`)).toBe('bare-client-before-any-session');
  });
  it('accepts each of the four protections', () => {
    expect(judgeRoute(`${head}export async function GET() { const sb = await serverClient(); const admin = createClient(u, k); }`)).toBe('ok');
    expect(judgeRoute(`${head}export async function GET() {} export async function POST() { const admin = createClient(u, k); }`)).toBe('ok');
    expect(judgeRoute(`${head}export const fetchCache = 'force-no-store';\nexport async function GET() { const admin = createClient(u, k); }`)).toBe('ok');
    expect(judgeRoute(`import { createNoStoreClient } from '@/lib/supabase-no-store';\nexport async function GET() { const admin = createNoStoreClient(u, k); }`)).toBe('ok');
  });
  it('does not take a comment for a protection', () => {
    expect(judgeRoute(`${head}// const sb = await serverClient();\nexport async function GET() { const admin = createClient(u, k); }`)).toBe('bare-client-before-any-session');
  });
});

describe('no GET-only route lets the fetch cache answer for its service-role client', () => {
  const routes = walk(`${SRC}/app/api`).filter((f) => f.endsWith(`${path.sep}route.ts`));
  const withClient = routes.filter((f) => /\bcreateClient\s*\(/.test(stripComments(fs.readFileSync(f, 'utf8'))));

  it('there are routes to check, and enough of them build a client for this to mean something', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(withClient.length).toBeGreaterThan(200);
  });

  it('none builds a bare client before it has read a session', () => {
    const offenders = withClient.filter((f) => judgeRoute(fs.readFileSync(f, 'utf8')) !== 'ok').map((f) => path.relative(SRC, f).split(path.sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('the routes found unsafe on 20/10/2026 are on the helper', () => {
    const fixed = [
      'app/api/network/invite-link/[token]/route.ts', // revoked / accepted invite link kept resolving as pending
      'app/api/plan-credits/route.ts', // force-dynamic, no cookie: an edited price-list number never showed
      'app/api/automations/route.ts', // the daily cron: GET() with no request
      'app/api/invite/incubator/[token]/route.ts', // safe only through clientIp(req) running first
      'app/api/invite/incubator/member/[token]/route.ts', // same
    ];
    for (const rel of fixed) {
      const code = stripComments(fs.readFileSync(`${SRC}/${rel}`, 'utf8'));
      expect(code, rel).toMatch(/createNoStoreClient\s*\(/);
      expect(code, rel).not.toMatch(/\bcreateClient\s*\(/);
    }
  });

  it('the libraries that build a service-role client for a public GET do it through the helper', () => {
    for (const rel of ['lib/account-security-server.ts', 'lib/capability-probe.ts']) {
      const code = stripComments(fs.readFileSync(`${SRC}/${rel}`, 'utf8'));
      expect(code, rel).toMatch(/createNoStoreClient\s*\(\s*url\s*,\s*service/);
      expect(code, rel).not.toMatch(/\bcreateClient\s*\(\s*url\s*,\s*service/);
    }
  });
});
