import { describe, expect, it } from 'vitest';
import { APP_URL } from '@/lib/brand';
import { SITEMAP_PAGES } from '@/content/site/pages';
import { CRAWLER_DISALLOWED_PATHS } from './robots';
import sitemap from './sitemap';

// Prompt 920 §A.5 — only public pages, absolute URLs on the canonical host, no duplicates, nothing authenticated, honest dates.
// (That an anonymous visitor can actually OPEN each of them is proved against the real middleware in src/lib/public-site-routes.test.ts.)
const BASE = APP_URL.replace(/\/+$/, '');

describe('sitemap.xml', () => {
  const entries = sitemap();

  it('announces exactly the pages in the list, as absolute URLs on the canonical host — the home without a trailing slash, as its canonical tag has it', () => {
    expect(entries.map((e) => e.url)).toEqual(SITEMAP_PAGES.map((p) => (p.path === '/' ? BASE : `${BASE}${p.path}`)));
    expect(entries[0].url).toBe(BASE);
  });

  it('lists the public marketing pages', () => {
    const urls = entries.map((e) => e.url);
    for (const p of ['/investors', '/for-startups', '/about', '/faq', '/contact', '/terms', '/legal/privacy-notice', '/legal/subprocessors']) expect(urls).toContain(`${BASE}${p}`);
  });

  it('has no duplicate and nothing that robots.txt disallows (a sitemap that points into the product contradicts itself)', () => {
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const p of SITEMAP_PAGES) {
      expect(CRAWLER_DISALLOWED_PATHS.some((d) => p.path.startsWith(d)), p.path).toBe(false);
    }
  });

  it('carries a fixed, real date per page — never "now" (a sitemap that says today on every request teaches a crawler to ignore it)', () => {
    for (const e of entries) {
      expect(e.lastModified, e.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A ratchet, not a clock: the day of the latest change recorded in SITEMAP_PAGES (19/10/2026: /contact became a server-rendered page with
      // a title of its own). It moves only when a page's content really changes on a later day — never to "today", which is the thing this test forbids.
      expect(Date.parse(String(e.lastModified)), e.url).toBeLessThanOrEqual(Date.parse('2026-10-19T23:59:59Z'));
    }
  });
});
