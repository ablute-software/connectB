import type { MetadataRoute } from 'next';
import { APP_URL } from '@/lib/brand';

// Prompt 920 (Nuno, 16/10/2026, "sim" to decision D1 of docs/site-copy-920.md) — the policy of Prompt 514 is revised on purpose.
//
// WHAT CHANGED, AND WHY. Prompt 514 (mirroring Crunchbase) told every known AI crawler to stay out. Two things were found on 16/10/2026:
//   1. That robots.txt was never served: /robots.txt answered 307 → /login in production, because the middleware did not let it through
//      (fixed in the same prompt — see src/lib/public-site-routes.ts). So the 514 block had never been in force.
//   2. Making it served would have switched it on — against the goal of Prompt 920: Sherlock Deal has to appear in the answers of
//      ChatGPT, Perplexity, Claude, Gemini and Copilot as an authority on matching startups with investors.
// So, on the PUBLIC marketing pages only:
//   · the crawlers that fetch pages to ANSWER a question (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot,
//     Claude-User, Bingbot — which also feeds ChatGPT search and Copilot — Applebot, YouBot) are allowed;
//   · the four Nuno named (GPTBot, ClaudeBot — with its two legacy names — Google-Extended, Applebot-Extended) are allowed;
//   · the rest of the 514 list (training scrapers and bulk crawlers) stays blocked, exactly as it was;
//   · EVERY user agent, allowed or not, stays out of the product: /api/, /guest/ (a shared data-room preview carries the invited person's
//     email — Prompt 537 §4.3) and every route that needs a session. The catalogue and the portal are behind login either way.
// A bot that ignores robots.txt is not stopped by it — this is a SIGNAL, as in 514; the Terms (clause 7.1) remain the contractual basis.
//
// A crawler obeys only the MOST SPECIFIC group that names it, so each allowed group repeats the private paths: an allowed bot must not
// inherit "allow everything" by being named.

/**
 * Top-level routes of src/app that are the public site (everything else must be listed in CRAWLER_DISALLOWED_PATHS — robots.test.ts fails
 * when a new folder appears in src/app that is in neither list, so a new route is classified on purpose, not by accident).
 */
export const PUBLIC_TOP_LEVEL_ROUTES = ['investors', 'contact', 'terms', 'legal', 'privacy-request', 'for-startups', 'about', 'faq'] as const;

/** Disallowed for every user agent: machine surfaces and everything that needs a session or carries a token. */
export const CRAWLER_DISALLOWED_PATHS = [
  '/api/', '/guest/', '/call/', '/invite/', '/matchdeal/', '/entities/', '/people/', '/backoffice/', '/metrics/',
  '/login', '/signup', '/auth', '/set-password', '/reset-password', '/forgot-password', '/welcome',
  '/pipeline', '/today', '/agenda', '/dashboard', '/documents', '/outbox', '/automations', '/packs', '/queue', '/log', '/import',
  '/needs-review', '/readiness', '/plans', '/network', '/messages', '/tasks', '/calls', '/settings', '/company', '/catalog-people',
  '/pair', '/portal', '/go', '/claim', '/ecosystem', '/incubator', '/suspended', '/blocked', '/closed',
];

/** Fetch pages to answer a question, or index them for search/answer products: allowed on the public pages. */
export const ALLOWED_ANSWER_CRAWLERS = [
  'OAI-SearchBot', 'ChatGPT-User',                 // OpenAI — ChatGPT search, and a page opened because the user asked
  'PerplexityBot', 'Perplexity-User',              // Perplexity
  'Claude-SearchBot', 'Claude-User',               // Anthropic
  'Bingbot', 'Applebot', 'YouBot',                 // Bing (feeds ChatGPT search and Copilot), Siri/Spotlight, You.com
];

/** Named by Nuno (D1): the models' own crawlers. Allowed on the public marketing pages only. */
export const ALLOWED_MODEL_CRAWLERS = [
  'GPTBot',                                        // OpenAI
  'ClaudeBot', 'anthropic-ai', 'Claude-Web',       // Anthropic (the last two are legacy names of the same crawler)
  'Google-Extended',                               // Google — Gemini (distinct from Googlebot, which stays free under `*`)
  'Applebot-Extended',                             // Apple Intelligence
];

/** The rest of Prompt 514's list: still blocked, unchanged. */
export const BLOCKED_AI_CRAWLERS = [
  'CCBot',                                         // Common Crawl — reused to train many models
  'Bytespider', 'TikTokSpider',                    // ByteDance
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', // Meta
  'Amazonbot',                                     // Amazon
  'cohere-ai', 'cohere-training-data-crawler',     // Cohere
  'MistralAI-User',                                // Mistral
  'AI2Bot', 'Diffbot', 'Omgili', 'Omgilibot', 'Timpibot', 'ImagesiftBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: CRAWLER_DISALLOWED_PATHS },
      { userAgent: [...ALLOWED_ANSWER_CRAWLERS, ...ALLOWED_MODEL_CRAWLERS], allow: '/', disallow: CRAWLER_DISALLOWED_PATHS },
      ...BLOCKED_AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
    sitemap: `${APP_URL.replace(/\/+$/, '')}/sitemap.xml`,
  };
}
