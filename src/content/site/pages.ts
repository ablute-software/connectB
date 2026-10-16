// Prompt 920 — titles and descriptions of the public pages, and the list the sitemap announces. The approved text is in
// docs/site-copy-920.md; this file is where it lives in the code.
//
// Every title starts with "Sherlock Deal —" (the name collides with other "Sherlock" companies; the title is what disambiguates it for
// a search engine and for an AI answer engine). Descriptions stay under 160 characters (a test checks both).
import { SITE_CONTENT_UPDATED } from './facts';

export interface PageMeta { title: string; description: string }

export const HOME_META: PageMeta = {
  title: 'Sherlock Deal — Find the right investors for your startup, and the right startups for your thesis',
  description: 'Sherlock Deal matches startups with investors that fit — by sector, stage, ticket size and geography — and gives investors startups that fit their mandate.',
};

export const FOR_STARTUPS_META: PageMeta = {
  title: 'Sherlock Deal — How to find investors for your startup',
  description: 'A five-step method to find investors that fit your startup — sector, stage, ticket size, geography, recent activity — and how Sherlock Deal does it for you.',
};

export const ABOUT_META: PageMeta = {
  title: 'Sherlock Deal — About: what it is and who runs it',
  description: 'Sherlock Deal is a fundraising workspace and matching platform for startups and investors, built in Portugal. What it does, who runs it and what it is not.',
};

export const FAQ_META: PageMeta = {
  title: 'Sherlock Deal — FAQ: finding investors, pricing, privacy',
  description: 'Answers on finding investors, preparing to raise, how Sherlock Deal matches startups and investors, pricing, privacy and what it does not do.',
};

/**
 * The pages the sitemap announces: public, indexable, nothing authenticated. `lastModified` is a fixed date per page — the day its content
 * last changed (the existing pages: the date of their last commit) — because a sitemap that says "today" on every request teaches a crawler
 * to ignore it.
 */
export const SITEMAP_PAGES: readonly { path: string; lastModified: string }[] = [
  { path: '/', lastModified: SITE_CONTENT_UPDATED },
  { path: '/investors', lastModified: SITE_CONTENT_UPDATED },
  { path: '/for-startups', lastModified: SITE_CONTENT_UPDATED },
  { path: '/about', lastModified: SITE_CONTENT_UPDATED },
  { path: '/faq', lastModified: SITE_CONTENT_UPDATED },
  { path: '/contact', lastModified: '2026-09-14' },
  { path: '/terms', lastModified: '2026-09-01' },
  { path: '/legal/privacy-notice', lastModified: '2026-09-09' },
  { path: '/legal/subprocessors', lastModified: '2026-09-09' },
];
