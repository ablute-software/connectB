import { describe, it, expect } from 'vitest';
import robots, { CRAWLER_DISALLOWED_PATHS } from './robots';

describe('robots.txt — Prompt 514 Part A', () => {
  const rules = robots().rules as { userAgent: string; allow?: string; disallow?: string | string[] }[];

  it('leaves the site open to everything not named, except the two private prefixes', () => {
    expect(rules[0]).toEqual({ userAgent: '*', allow: '/', disallow: ['/guest/', '/api/'] });
  });

  it('disallows the AI crawlers Crunchbase names, and every other rule is a disallow', () => {
    const disallowed = new Set(rules.slice(1).map((r) => r.userAgent));
    for (const bot of ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider', 'Applebot-Extended']) {
      expect(disallowed.has(bot)).toBe(true);
    }
    for (const r of rules.slice(1)) expect(r.disallow).toBe('/');
  });

  // Prompt 537 §4.3 — a guest link's page carries the invited person's email
  // address and the startup's document names. It must not be indexable by
  // ANY crawler, not only the AI ones.
  it('disallows /guest/ and /api/ for every user agent, not just AI crawlers', () => {
    expect(CRAWLER_DISALLOWED_PATHS).toContain('/guest/');
    expect(CRAWLER_DISALLOWED_PATHS).toContain('/api/');
    expect(rules[0].userAgent).toBe('*');
    expect(rules[0].disallow).toEqual(CRAWLER_DISALLOWED_PATHS);
  });

  it('still lets a normal search engine index the marketing site', () => {
    // The disallow is two prefixes, never a blanket block — narrowing the
    // `*` allow instead would have quietly de-indexed the whole product.
    expect(rules[0].allow).toBe('/');
    const disallowed = rules[0].disallow as string[];
    for (const publicPath of ['/', '/login', '/signup', '/plans']) {
      expect(disallowed.some((p) => publicPath.startsWith(p))).toBe(false);
    }
  });

  it('never blocks a normal search engine — the site has to stay indexable', () => {
    const blocked = rules.slice(1).map((r) => r.userAgent);
    for (const engine of ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Slurp', 'Applebot', 'Baiduspider', 'YandexBot']) {
      expect(blocked).not.toContain(engine);
    }
  });

  it('lists each user-agent exactly once', () => {
    const all = rules.map((r) => r.userAgent);
    expect(new Set(all).size).toBe(all.length);
  });
});
