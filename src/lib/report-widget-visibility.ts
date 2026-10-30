// 30/10/2026 — Nuno: the floating "Tell us" button (ReportProblemWidget, mounted once in the root layout) opened "Report a problem" for an anonymous visitor on the landing
// pages, where it makes no sense: the visitor does not use the product yet. It is not drawn on the public marketing pages. The list is the one the Shell already renders
// bare (the landing `/`, `/investors` and its sub-routes, and the marketing pages of public-site-routes.ts); /contact, the sign-in pages and the rest keep the button.
// Pure, so the same rule is tested without a browser.
import { isPublicSitePage } from './public-site-routes';

export function isLandingPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return path === '/' || path === '/investors' || path.startsWith('/investors/') || isPublicSitePage(path);
}

export function showsReportProblemWidget(path: string | null | undefined): boolean {
  return !isLandingPath(path);
}
