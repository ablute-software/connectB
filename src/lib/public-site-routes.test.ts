// Prompt 920 — the public marketing site must be reachable by someone with no session, and by a crawler. On 16/10/2026 /robots.txt and
// /sitemap.xml were found answering 307 → /login in production: the middleware's PUBLIC list did not include them, and a robots.ts that
// nobody could read had been "done" since Prompt 514. So this drives the REAL middleware (not a copy of its list) over every page the
// sitemap announces and over both files, with no session, and proves the private routes still redirect.
//
// dev:verify cannot catch this (demo mode skips the middleware entirely), which is why it is a test and not a browser check.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SITE_FILES, PUBLIC_SITE_PAGES, PUBLIC_SITE_PATHS, isPublicSitePage } from './public-site-routes';
import { SITEMAP_PAGES } from '@/content/site/pages';

// An unauthenticated caller is the case under test.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: 'active' }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

let middleware: (req: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
let NextRequest: typeof import('next/server').NextRequest;

beforeAll(async () => {
  // Set BEFORE importing: absent env vars are demo mode, which lets everything through and would make every assertion vacuous.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  ({ NextRequest } = await import('next/server'));
  ({ middleware } = await import('../middleware'));
});

const get = (p: string) => new NextRequest(new URL(p, 'https://www.sherlockdeal.com'), { method: 'GET' });
const ROOT = path.resolve(__dirname, '../..');

describe('the public site is open to a visitor with no session', () => {
  it('every page the sitemap announces passes the middleware without a redirect', async () => {
    for (const page of SITEMAP_PAGES) {
      const res = await middleware(get(page.path));
      expect(res.status, page.path).not.toBe(307);
      expect(res.headers.get('location'), page.path).toBeNull();
    }
  });

  it('/robots.txt and /sitemap.xml pass too — the two files the whole effort depends on', async () => {
    for (const file of PUBLIC_SITE_FILES) {
      const res = await middleware(get(file));
      expect(res.status, file).not.toBe(307);
      expect(res.headers.get('location'), file).toBeNull();
    }
  });

  it('the three new marketing pages pass', async () => {
    for (const page of PUBLIC_SITE_PAGES) {
      const res = await middleware(get(page));
      expect(res.status, page).not.toBe(307);
    }
  });

  it('the list is exact: nothing that merely starts like a public path gets in', async () => {
    // (the middleware matches a path or anything UNDER it — `/faq/x` would pass and 404, nothing exists there; what must never pass is a
    // sibling that only shares a prefix of letters)
    for (const p of ['/for-startups-evil', '/about-us', '/faq2', '/robots.txt.bak', '/sitemap.xml.gz', '/fortune']) {
      const res = await middleware(get(p));
      expect(res.status, p).toBe(307);
      expect(res.headers.get('location'), p).toContain('/login');
    }
  });

  it('the product stays behind the login: no private route became public by this change', async () => {
    for (const p of ['/pipeline', '/today', '/settings', '/dashboard', '/documents', '/readiness', '/network', '/messages', '/backoffice', '/ecosystem', '/api/website-health', '/api/company/visibility']) {
      const res = await middleware(get(p));
      expect(res.status, p).toBe(307);
      expect(res.headers.get('location'), p).toContain('/login');
    }
  });
});

describe('the shared list', () => {
  it('is what the middleware, the Shell and the sitemap read', () => {
    expect(PUBLIC_SITE_PATHS).toEqual(['/for-startups', '/about', '/faq', '/robots.txt', '/sitemap.xml']);
    // the Shell renders these bare through isPublicSitePage; the files are not pages
    for (const p of PUBLIC_SITE_PAGES) { expect(isPublicSitePage(p), p).toBe(true); expect(isPublicSitePage(`${p}/x`), `${p}/x`).toBe(true); }
    for (const f of PUBLIC_SITE_FILES) expect(isPublicSitePage(f), f).toBe(false);
    for (const p of ['/', '/investors', '/pipeline', '/faqs', '/about-us', null, undefined, '']) expect(isPublicSitePage(p as string | null | undefined), String(p)).toBe(false);
  });

  it('the Shell actually calls it (a client component cannot be driven here, so the call site is pinned)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(path.join(ROOT, 'src/components/shell.tsx'), 'utf8');
    expect(src).toContain("import { isPublicSitePage } from '@/lib/public-site-routes';");
    expect(src).toMatch(/isBareShellRoute[\s\S]{0,1800}\|\| isPublicSitePage\(path\);/);
  });

  it('every page the sitemap lists exists as a route in src/app (a sitemap never announces a page that is not there)', () => {
    for (const page of SITEMAP_PAGES) {
      const file = page.path === '/' ? 'src/app/page.tsx' : `src/app${page.path}/page.tsx`;
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });
});
