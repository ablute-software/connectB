import { describe, it, expect } from 'vitest';
import robots from './robots';

describe('robots.txt — Prompt 514 Part A', () => {
  const rules = robots().rules as { userAgent: string; allow?: string; disallow?: string }[];

  it('leaves the site open to everything not named', () => {
    expect(rules[0]).toEqual({ userAgent: '*', allow: '/' });
  });

  it('disallows the AI crawlers Crunchbase names, and every other rule is a disallow', () => {
    const disallowed = new Set(rules.slice(1).map((r) => r.userAgent));
    for (const bot of ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider', 'Applebot-Extended']) {
      expect(disallowed.has(bot)).toBe(true);
    }
    for (const r of rules.slice(1)) expect(r.disallow).toBe('/');
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
