// Prompt 933 — the auth gate used to be closed by default (a path nobody had classified asked for a login). It is now closed only for what is behind a session, and a path that nothing in the app
// answers goes on to Next's 404. That is safe exactly as long as the lists in src/lib/route-zones.ts say what is really in src/app, so this reads the folders on disk and fails, both ways, when a
// folder is missing from the lists or a list names a folder that is not there. It is the same design as src/app/robots.test.ts, for the same reason: a new route must be classified on purpose.
//
// The second half drives the REAL middleware over the behaviours the prompt names, with no session. dev:verify cannot show any of this (demo mode skips the middleware), which is why it is a test.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { API_ZONES, PROTECTED_PAGE_ZONES, PUBLIC_PATHS, isApiPath, isPublicPath, isUnknownPath } from './route-zones';

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: 'active' }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

const ROOT = path.resolve(__dirname, '..', '..');
const folders = (dir: string) => readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort();

describe('the lists say what is really in src/app (a new route cannot be forgotten, a removed one cannot linger)', () => {
  const pageFolders = folders(path.join(ROOT, 'src', 'app')).filter((n) => n !== 'api');
  const publicFirstSegments = new Set(PUBLIC_PATHS.map((p) => p.split('/')[1]).filter(Boolean));

  // `src/app/api/[...slug]` answers 404 JSON for an API path no route owns (it is not a zone: it owns nothing)
  const apiFolders = folders(path.join(ROOT, 'src', 'app', 'api'));
  const apiZoneFolders = apiFolders.filter((n) => !n.startsWith('['));

  it('there are many folders to classify (the scan is not vacuous)', () => {
    expect(pageFolders.length).toBeGreaterThan(40);
    expect(apiZoneFolders.length).toBeGreaterThan(50);
  });

  // The whole design rests on "a path nothing answers exists". A catch-all PAGE at the top of src/app would answer every address there is, and the unknown-path rule would be a lie.
  it('no folder at the top of src/app is dynamic, and the only dynamic folder at the top of src/app/api is the catch-all that answers 404 JSON', () => {
    expect(pageFolders.filter((n) => n.startsWith('[') || n.startsWith('('))).toEqual([]);
    expect(apiFolders.filter((n) => n.startsWith('['))).toEqual(['[...slug]']);
  });

  it('every top-level folder of src/app is protected or has a public path — otherwise it would be open to everybody', () => {
    const protectedNames = new Set(PROTECTED_PAGE_ZONES.map((z) => z.slice(1)));
    const unclassified = pageFolders.filter((name) => !protectedNames.has(name) && !publicFirstSegments.has(name));
    expect(unclassified, 'add it to PROTECTED_PAGE_ZONES (it needs a session) or to PUBLIC_PATHS (it is open) in src/lib/route-zones.ts').toEqual([]);
  });

  it('PROTECTED_PAGE_ZONES names only folders that exist, once each, in the form the matcher expects', () => {
    for (const z of PROTECTED_PAGE_ZONES) {
      expect(z, z).toMatch(/^\/[a-z0-9-]+$/);
      expect(pageFolders, z).toContain(z.slice(1));
    }
    expect(new Set(PROTECTED_PAGE_ZONES).size).toBe(PROTECTED_PAGE_ZONES.length);
  });

  it('API_ZONES is exactly the folders of src/app/api (both ways)', () => {
    expect([...API_ZONES].sort()).toEqual(apiZoneFolders);
  });

  it('a folder that is public AND has protected pages (/network) is listed as protected, so only its public sub-paths are open', () => {
    expect(PROTECTED_PAGE_ZONES).toContain('/network');
    for (const open of ['/network/invite', '/network/connect']) expect(PUBLIC_PATHS, open).toContain(open);
    expect(isPublicPath('/network')).toBe(false);
    expect(isPublicPath('/network/invite/abc')).toBe(true);
  });

  it('no protected page zone is also a whole-folder public entry (a folder that is open and protected at once is a mistake)', () => {
    for (const z of PROTECTED_PAGE_ZONES) expect(PUBLIC_PATHS, z).not.toContain(z);
  });
});

describe('isUnknownPath — what nothing in the app answers', () => {
  it('names the paths of the prompt: a mistyped address, a made-up sub-path of a public page, a made-up API route', () => {
    for (const p of ['/qualquer-coisa-que-nao-existe', '/for-startups-evil', '/about-us', '/faq2', '/robots.txt.bak', '/sitemap.xml.gz', '/fortune', '/wp-login.php', '/.env', '/api/isto-nao-existe', '/api', '/api/']) {
      expect(isUnknownPath(p), p).toBe(true);
    }
  });

  it('a public path is never unknown, a protected one neither (not even a sub-path nobody built — the zone is behind a session)', () => {
    for (const p of ['/', '/investors', '/login', '/faq', '/for-startups', '/call/abcdefghijklmnopqrstuv', '/api/me', '/api/calls/public/x', '/network/invite/t', '/matchdeal/pair']) expect(isUnknownPath(p), p).toBe(false);
    for (const p of ['/dashboard', '/dashboard/x', '/pipeline', '/pipeline/anything', '/calls', '/calls/some-id', '/settings', '/backoffice', '/backoffice/x/y', '/metrics', '/entities/ent-1', '/network', '/welcome/commitments',
      '/api/calls', '/api/calls/some-id', '/api/automations', '/api/automations/x', '/api/backoffice/metrics/overview', '/api/org/update', '/api/pipeline-unlock']) expect(isUnknownPath(p), p).toBe(false);
  });

  it('a sibling that only shares the first letters of a protected zone is unknown (nothing lives there), and so is /matchdeal outside /matchdeal/pair', () => {
    for (const p of ['/pipelinex', '/dashboards', '/settingsx', '/api/pipelinex', '/api/automations-x', '/matchdeal', '/matchdeal/other']) expect(isUnknownPath(p), p).toBe(true);
  });

  // Why this matters: the old default was closed, the new one is open for an unknown path. If a router could read a protected path in a form this classifier does not recognise, an anonymous visitor
  // would be let through. These are the forms the classifier folds; every one of them must still be "not unknown" (the login gate), and a form that is not any zone stays unknown.
  it('cannot be fooled by case, doubled slashes, backslashes or percent-encoding of a protected path', () => {
    const disguised = ['/Dashboard', '/PIPELINE/x', '//dashboard', '/dashboard//x', '/%64ashboard', '/%44ASHBOARD', '/dash%62oard/x', '/pipeline%2Fx', '/%2570ipeline', '/%252570ipeline',
      '/\\dashboard', '/api//calls', '/API/CALLS/x', '/api/%63alls', '/%61pi/calls', '/api/calls%2Fx', '/network%2F'];
    for (const p of disguised) expect(isUnknownPath(p), p).toBe(false);
  });

  it('keeps the gate for a path that cannot be decoded, or that is encoded more than three times', () => {
    for (const p of ['/%', '/foo%zz', '/dashboard%', '/%25252525252570ipeline']) expect(isUnknownPath(p), p).toBe(false);
  });

  // The entry '/' of the public list used to match every path that begins with a doubled slash (startsWith('//')), so `//dashboard` was "public" to the old middleware (Next redirects it with a 308 before the middleware
  // runs, so it was never reachable — the classifier must not depend on that).
  it('the root is public only as the root: a doubled slash in front of a protected path is not a public path', () => {
    expect(isPublicPath('/')).toBe(true);
    for (const p of ['//', '//dashboard', '///pipeline', '//login']) expect(isPublicPath(p), p).toBe(false);
    expect(isUnknownPath('//dashboard')).toBe(false);
    expect(isUnknownPath('//qualquer-coisa')).toBe(true);
  });

  it('isApiPath is /api and what is under it, nothing that merely starts with those letters', () => {
    for (const p of ['/api', '/api/', '/api/me', '/api/x/y']) expect(isApiPath(p), p).toBe(true);
    for (const p of ['/apix', '/apiary', '/', '/investors/api', '/API']) expect(isApiPath(p), p).toBe(false);
  });
});

let middleware: (req: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
let NextRequest: typeof import('next/server').NextRequest;

beforeAll(async () => {
  // Set BEFORE importing: absent env vars are demo mode, which lets everything through and would make every assertion vacuous.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  ({ NextRequest } = await import('next/server'));
  ({ middleware } = await import('../middleware'));
});

// The host is glued in front of the path, never resolved against it: `new URL('//dashboard', base)` is a protocol-relative URL whose HOST is "dashboard", which is not what a server hands the middleware
// (Next builds `scheme://host` + the raw request path, so a doubled slash stays in the pathname).
const call = (p: string, method = 'GET') => new NextRequest(new URL(`https://www.sherlockdeal.com${p}`), { method });

describe('the real middleware, with no session', () => {
  it('a page path nothing answers is NOT sent to /login: it goes on to Next (which answers 404)', async () => {
    for (const p of ['/qualquer-coisa-que-nao-existe', '/for-startups/qualquer-coisa', '/faq2', '/about-us', '/wp-login.php', '/fortune']) {
      const res = await middleware(call(p));
      expect(res.status, p).toBe(200);
      expect(res.headers.get('location'), p).toBeNull();
      // `next()` marks the response as "continue to the router"; a redirect or a rewrite would carry another header.
      expect(res.headers.get('x-middleware-next'), p).toBe('1');
    }
  });

  it('an API path nothing answers is 404 as JSON, never a redirect to an HTML page — for every method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await middleware(call('/api/isto-nao-existe', method));
      expect(res.status, method).toBe(404);
      expect(res.headers.get('location'), method).toBeNull();
      expect(res.headers.get('content-type'), method).toContain('application/json');
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('not_found');
    }
    const bare = await middleware(call('/api'));
    expect(bare.status).toBe(404);
  });

  it('a protected page still goes to /login?next=…, as before', async () => {
    for (const p of ['/dashboard', '/pipeline', '/calls', '/settings', '/backoffice', '/entities/ent-1', '/welcome/commitments', '/suspended', '/blocked', '/auth-code-test']) {
      const res = await middleware(call(p));
      expect(res.status, p).toBe(307);
      const to = new URL(res.headers.get('location') ?? '');
      expect(to.pathname, p).toBe('/login');
      expect(to.searchParams.get('next'), p).toBe(p);
    }
  });

  it('a protected API route still goes to /login, as before (it is not made a 404, and it is not made public)', async () => {
    for (const p of ['/api/calls', '/api/org/update', '/api/pipeline-unlock', '/api/backoffice/metrics/overview', '/api/calls/does-not-exist-in-this-zone']) {
      const res = await middleware(call(p, 'POST'));
      expect(res.status, p).toBe(307);
      expect(res.headers.get('location'), p).toContain('/login');
    }
  });

  it('a protected path in disguise is still sent to /login, never let through as "unknown"', async () => {
    for (const p of ['/Dashboard', '//dashboard', '/%64ashboard', '/pipeline%2Fx', '/%2570ipeline', '/api//calls', '/api/%63alls', '/%']) {
      const res = await middleware(call(p));
      expect(res.status, p).toBe(307);
      expect(res.headers.get('location'), p).toContain('/login');
    }
  });

  it('what is public stays public (the list moved, its content did not)', async () => {
    for (const p of ['/', '/investors', '/login', '/signup', '/faq', '/about', '/for-startups', '/contact', '/terms', '/legal/privacy-notice', '/call/abcdefghijklmnopqrstuv', '/api/calls/public/abcdefghijklmnopqrstuv', '/api/me',
      '/api/plan-credits', '/go', '/robots.txt', '/sitemap.xml', '/network/invite/abc', '/api/provision-org']) {
      const res = await middleware(call(p));
      expect(res.status, p).not.toBe(307);
      expect(res.status, p).not.toBe(404);
      expect(res.headers.get('location'), p).toBeNull();
    }
  });
});
