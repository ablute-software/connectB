// Prompt 920 — the public marketing site that is NOT the landing, in ONE list, read by everything that has to agree about it:
//
//   · src/middleware.ts          — what an anonymous visitor (and a crawler) may open without being sent to /login;
//   · src/components/shell.tsx   — which routes render bare, without the founder app's sidebar and header;
//   · src/app/sitemap.ts         — which pages the sitemap announces (the page list lives in src/content/site/pages.ts, and a
//                                  test drives the REAL middleware over every one of them).
//
// Why a shared list: on 16/10/2026 `/robots.txt` and `/sitemap.xml` were found answering 307 → /login in production (the middleware only
// let its PUBLIC list through, and a file crawlers read was not on it), so a robots.ts written in August (Prompt 514) had never been
// served to anybody. Three places that must agree and used to be edited by hand are how that happens.
//
// Pure on purpose: no imports, safe in the Edge runtime (middleware) and in client components (Shell).

/** Marketing pages: public, indexable, rendered bare (their own nav and footer). */
export const PUBLIC_SITE_PAGES = ['/for-startups', '/about', '/faq'] as const;

/** Files crawlers read: public, never rendered as pages. */
export const PUBLIC_SITE_FILES = ['/robots.txt', '/sitemap.xml'] as const;

/** Everything the middleware must let through with no session. Exact paths — no wide prefixes. */
export const PUBLIC_SITE_PATHS: readonly string[] = [...PUBLIC_SITE_PAGES, ...PUBLIC_SITE_FILES];

/** True for one of the marketing pages (or a path under it): the Shell renders these bare. */
export function isPublicSitePage(path: string | null | undefined): boolean {
  if (!path) return false;
  return PUBLIC_SITE_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}
