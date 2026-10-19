import type { MetadataRoute } from 'next';
import { APP_URL } from '@/lib/brand';
import { SITEMAP_PAGES } from '@/content/site/pages';

// Prompt 920 §A.5 — the sitemap lists the public pages only (src/content/site/pages.ts); nothing authenticated is ever in it. The home is
// announced without a trailing slash, exactly as its canonical tag is, so the two never disagree about which URL is the page.
// middleware.test.ts drives the real middleware over every entry: a page in this list that an anonymous visitor cannot open is a failing test.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = APP_URL.replace(/\/+$/, '');
  return SITEMAP_PAGES.map((p) => ({ url: p.path === '/' ? base : `${base}${p.path}`, lastModified: p.lastModified }));
}
