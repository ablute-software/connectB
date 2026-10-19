import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { APP_URL } from '@/lib/brand';
import robots, {
  ALLOWED_ANSWER_CRAWLERS, ALLOWED_MODEL_CRAWLERS, BLOCKED_AI_CRAWLERS, CRAWLER_DISALLOWED_PATHS, PUBLIC_TOP_LEVEL_ROUTES,
} from './robots';

// Prompt 514/537 wrote the first version of this policy (block every known AI crawler, plus /guest/ and /api/ for everybody). Prompt 920
// (Nuno, 16/10/2026, "sim" to decision D1 of docs/site-copy-920.md) revises it on purpose: the crawlers that answer questions, and the four
// Nuno named, are now allowed on the PUBLIC marketing pages; the rest of the 514 list stays blocked; the private paths stay private for
// everybody. The reason is in robots.ts. What has NOT changed — and is still asserted below — is the 537 rule that no crawler of any kind is
// let near /guest/ or /api/, and that a normal search engine is never blocked.
type Rule = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = robots().rules as Rule[];
const agents = (r: Rule): string[] => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]);
const ROOT = path.resolve(__dirname, '..', '..');

describe('robots.txt — Prompt 920 (revises Prompt 514)', () => {
  it('leaves the site open to everything not named, except the private paths', () => {
    expect(rules[0]).toEqual({ userAgent: '*', allow: '/', disallow: CRAWLER_DISALLOWED_PATHS });
  });

  it('allows the crawlers that answer questions, and the four Nuno named — on the public pages only', () => {
    const group = rules[1];
    expect(agents(group).sort()).toEqual([...ALLOWED_ANSWER_CRAWLERS, ...ALLOWED_MODEL_CRAWLERS].sort());
    expect(group.allow).toBe('/');
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User', 'Bingbot', 'Applebot']) {
      expect(agents(group), bot).toContain(bot);
    }
    for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended']) expect(agents(group), bot).toContain(bot);
  });

  it('an allowed crawler does NOT inherit "allow everything": its own group repeats every private path (a crawler obeys only the most specific group)', () => {
    expect(rules[1].disallow).toEqual(CRAWLER_DISALLOWED_PATHS);
    for (const p of ['/api/', '/guest/']) expect(rules[1].disallow, p).toContain(p);
  });

  it('the rest of the 514 list stays blocked outright', () => {
    const blocked = rules.slice(2);
    expect(blocked.map((r) => r.userAgent)).toEqual(BLOCKED_AI_CRAWLERS);
    for (const r of blocked) expect(r.disallow).toBe('/');
    for (const bot of ['CCBot', 'Bytespider', 'Meta-ExternalAgent', 'Amazonbot', 'cohere-ai', 'MistralAI-User', 'Diffbot']) expect(BLOCKED_AI_CRAWLERS).toContain(bot);
  });

  it('no crawler is both allowed and blocked, and each user agent appears exactly once', () => {
    const all = rules.flatMap(agents);
    expect(new Set(all).size).toBe(all.length);
    for (const bot of BLOCKED_AI_CRAWLERS) {
      expect(ALLOWED_ANSWER_CRAWLERS, bot).not.toContain(bot);
      expect(ALLOWED_MODEL_CRAWLERS, bot).not.toContain(bot);
    }
  });

  it('never blocks a normal search engine — the site has to stay indexable', () => {
    const blocked = rules.filter((r) => r.disallow === '/').flatMap(agents);
    for (const engine of ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Slurp', 'Applebot', 'Baiduspider', 'YandexBot']) expect(blocked).not.toContain(engine);
  });

  // Prompt 537 §4.3 — a guest link's page carries the invited person's email and the startup's document names; /api/ has no indexable content.
  it('keeps /guest/ and /api/ out of reach of every group that is allowed in', () => {
    for (const r of rules.filter((x) => x.allow)) {
      expect(r.disallow, JSON.stringify(r.userAgent)).toEqual(expect.arrayContaining(['/guest/', '/api/']));
    }
  });

  it('announces the sitemap at the canonical address', () => {
    expect(robots().sitemap).toBe(`${APP_URL.replace(/\/+$/, '')}/sitemap.xml`);
  });

  it('the public pages are not disallowed (a blanket rule would de-index the whole site)', () => {
    for (const p of ['/', '/investors', '/for-startups', '/about', '/faq', '/contact', '/terms', '/legal/privacy-notice', '/legal/subprocessors', '/privacy-request']) {
      expect(CRAWLER_DISALLOWED_PATHS.some((d) => (d === '/' ? true : p.startsWith(d))), p).toBe(false);
    }
  });

  it('every top-level folder of src/app is classified: a public page, or disallowed — a new route cannot be forgotten', () => {
    const appDir = path.join(ROOT, 'src', 'app');
    const folders = readdirSync(appDir).filter((n) => statSync(path.join(appDir, n)).isDirectory());
    expect(folders.length).toBeGreaterThan(40);
    const unclassified = folders.filter((name) => {
      if ((PUBLIC_TOP_LEVEL_ROUTES as readonly string[]).includes(name)) return false;
      return !CRAWLER_DISALLOWED_PATHS.some((d) => `/${name}/`.startsWith(d) || `/${name}`.startsWith(d));
    });
    expect(unclassified, 'add it to PUBLIC_TOP_LEVEL_ROUTES (a marketing page) or to CRAWLER_DISALLOWED_PATHS (the product)').toEqual([]);
  });

  it('the public list names only folders that exist (no stale entry)', () => {
    const appDir = path.join(ROOT, 'src', 'app');
    for (const name of PUBLIC_TOP_LEVEL_ROUTES) expect(statSync(path.join(appDir, name)).isDirectory(), name).toBe(true);
  });
});
