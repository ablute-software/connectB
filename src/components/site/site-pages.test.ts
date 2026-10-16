// Prompt 920 — the three new pages, rendered with react-dom/server (no DOM library in this repo): what a crawler receives is the HTML, so
// that is what is asserted. The properties that matter for a page meant to be quoted by an answer engine: every answer is IN the HTML (the
// accordion only hides it), one H1, the schema describes exactly what the page says, every number is one the product states, every link
// points at a page that exists, and the page's own styles cannot lose to the landing's reset depending on import order.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/font only exists inside Next's compiler; the layout calls it at module scope.
vi.mock('next/font/google', () => ({ Fraunces: () => ({ variable: 'font-fraunces' }), Inter: () => ({ variable: 'font-inter' }) }));

import { PLANS } from '@/lib/plans';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from '@/lib/pipeline-unlock';
import { allFaqItems, findingInvestmentItems } from '@/content/site/faq';
import { CATALOGUE_FLOOR, COUNTRIES_FLOOR, DAILY_TARGET_WORDS, WEEKLY_TARGET_WORDS } from '@/content/site/facts';
import { FOR_STARTUPS_H1, FOR_STARTUPS_STEPS, LISTS_FAIL } from '@/content/site/for-startups';
import { plainAnswer } from '@/lib/site-schema';
import AboutPage from '@/app/about/page';
import FaqPage from '@/app/faq/page';
import ForStartupsPage from '@/app/for-startups/page';
import { FOOTER_COLUMNS } from './PublicSiteLayout';

const ROOT = path.resolve(__dirname, '../../..');
const html = (page: () => React.ReactElement) => renderToStaticMarkup(page());
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Block tags separate words; inline tags (a, b, strong, span, em) do not — "startup</a>." must read "startup.", as a person reads it.
const textOf = (markup: string) => decode(markup
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<\/?(?:p|div|h\d|li|ul|ol|dl|dt|dd|details|summary|section|nav|main|footer|header|label|button|br)\b[^>]*>/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/\s+/g, ' ')
  .trim());
const jsonLd = (markup: string) => [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as { '@graph': Record<string, unknown>[] });
const count = (markup: string, re: RegExp) => (markup.match(re) ?? []).length;

const faq = html(() => createElement(FaqPage));
const forStartups = html(() => createElement(ForStartupsPage));
const about = html(() => createElement(AboutPage));

describe('/faq', () => {
  it('has one H1, one main landmark, and the nav in its solid state (no dark hero behind it)', () => {
    expect(count(faq, /<h1[ >]/g)).toBe(1);
    expect(count(faq, /<main[ >]/g)).toBe(1);
    expect(faq).toContain('data-scrolled="true"');
  });

  it('puts all twenty questions and all twenty answers IN the HTML — the accordion is only visual', () => {
    expect(count(faq, /<details[ >]/g)).toBe(20);
    const text = textOf(faq);
    for (const item of allFaqItems()) {
      expect(text, item.q).toContain(item.q);
      expect(text, item.id).toContain(plainAnswer(item.a));
    }
  });

  it('its FAQPage schema is the same twenty questions, in the same words', () => {
    const [g] = jsonLd(faq);
    const page = g['@graph'].find((n) => n['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(page.mainEntity).toHaveLength(20);
    const text = textOf(faq);
    for (const e of page.mainEntity) { expect(text).toContain(e.name); expect(text).toContain(e.acceptedAnswer.text); }
  });

  it('groups the questions under five headings, in order', () => {
    expect([...faq.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => decode(m[1]))).toEqual([
      'Finding investment', 'How Sherlock Deal helps', 'Getting started and sharing information', 'Fundraising and first contact', 'For investors and ecosystem organisations',
    ]);
  });
});

describe('/for-startups', () => {
  it('states the answer first: H1, then the direct answer, before any section', () => {
    expect(count(forStartups, /<h1[ >]/g)).toBe(1);
    expect(textOf(forStartups)).toContain(FOR_STARTUPS_H1);
    expect(forStartups.indexOf('The right investors for your startup are the ones')).toBeLessThan(forStartups.indexOf('Why most investor lists fail'));
  });

  it('has the four reasons lists fail, the five steps in an ordered list, and the plan quotas read from the product', () => {
    const text = textOf(forStartups);
    for (const l of LISTS_FAIL) expect(text).toContain(l.lead);
    expect(count(forStartups, /<ol>[\s\S]*?<\/ol>/g)).toBe(1);
    for (const s of FOR_STARTUPS_STEPS) expect(text).toContain(`${s.name}.`);
    const q = PLAN_PIPELINE_MONTHLY_ADDITION;
    expect(text).toContain(`up to ${q.idea} new curated investors a month`);
    expect(text).toContain(`up to ${q.garage} and up to ${q.motherfunding}`);
    expect(text).toContain(`${DAILY_TARGET_WORDS} a day and ${WEEKLY_TARGET_WORDS} a week by default`);
    expect(text).toContain(`${CATALOGUE_FLOOR} verified investor profiles across more than ${COUNTRIES_FLOOR} European countries`);
  });

  it('says only that four things are scored — and recent activity only as advice in step 4', () => {
    const text = textOf(forStartups);
    expect(text).toContain('against your company on sector, stage, ticket size and geography');
    expect(text).toContain('Check recent activity.');
  });

  it('repeats the five "Finding investment" questions with their answers, and calls to action that lead to sign-up', () => {
    const text = textOf(forStartups);
    for (const i of findingInvestmentItems()) { expect(text).toContain(i.q); expect(text).toContain(plainAnswer(i.a)); }
    expect(count(forStartups, /<details[ >]/g)).toBe(5);
    expect(count(forStartups, /href="\/signup"/g)).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Free to start. No credit card required.');
  });

  it('carries HowTo (five steps) and FAQPage (five questions)', () => {
    const [g] = jsonLd(forStartups);
    const types = g['@graph'].map((n) => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'HowTo', 'FAQPage', 'BreadcrumbList']));
    expect((g['@graph'].find((n) => n['@type'] === 'HowTo') as { step: unknown[] }).step).toHaveLength(5);
    expect((g['@graph'].find((n) => n['@type'] === 'FAQPage') as { mainEntity: unknown[] }).mainEntity).toHaveLength(5);
  });

  it('marks "For Startups" as the current side in the toggle', () => {
    expect(forStartups).toMatch(/aria-selected="true"[^>]*href="\/for-startups"/);
  });
});

describe('/about', () => {
  const text = textOf(about);

  it('defines the product in its first sentence and names who runs it', () => {
    expect(count(about, /<h1[ >]/g)).toBe(1);
    expect(text).toContain('Sherlock Deal is a fundraising workspace and matching platform that connects startups with the investors that fit them.');
    expect(text).toContain('Sherlock Deal is operated by Exotictarget, Lda, a company registered in Portugal (Viana do Castelo).');
  });

  it('says what it is NOT in the Terms\' own words (4.4, 4.5) — and promises no outcome', () => {
    expect(text).toContain('Sherlock Deal is not an investor, a broker or a crowdfunding platform. It does not hold funds, does not give investment advice, and does not verify or guarantee any information, valuation or transaction.');
    expect(text).toContain('A match score is a guide, not a recommendation, and it creates no expectation of an introduction, a meeting or an investment.');
    expect(text).toContain('Today Sherlock Deal takes no equity and no success fee.');
  });

  it('states the privacy principle and where the catalogue comes from, with the links people need', () => {
    expect(text).toContain("Sherlock Deal never shows investors a founder's internal performance data");
    expect(text).toContain('The catalogue is compiled and verified from public sources.');
    for (const href of ['/legal/privacy-notice', '/privacy-request', '/contact']) expect(about).toContain(`href="${href}"`);
  });

  it('carries AboutPage and the organisation', () => {
    const [g] = jsonLd(about);
    expect(g['@graph'].map((n) => n['@type'])).toEqual(expect.arrayContaining(['Organization', 'AboutPage', 'BreadcrumbList']));
  });
});

describe('all three pages', () => {
  const pages: [string, string][] = [['/faq', faq], ['/for-startups', forStartups], ['/about', about]];

  it('state no number that is not one the product or facts.ts states', () => {
    const allowed = new Set<string>([
      String(CATALOGUE_FLOOR), String(COUNTRIES_FLOOR), '20', String(new Date().getFullYear()),
      ...Object.values(PLAN_PIPELINE_MONTHLY_ADDITION).map(String),
      ...PLANS.map((p) => String(p.monthlyEur)),
    ]);
    for (const [name, markup] of pages) {
      const stray = [...textOf(markup).matchAll(/\d[\d,]*/g)].map((m) => m[0]).filter((n) => !allowed.has(n));
      expect(stray, name).toEqual([]);
    }
  });

  it('link only to pages that exist (the footer, the breadcrumb, the cross-links)', () => {
    const hrefs = new Set<string>();
    for (const [, markup] of pages) for (const m of markup.matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) hrefs.add(m[1]);
    for (const col of FOOTER_COLUMNS) for (const l of col.links) hrefs.add(l.href.split('#')[0] || '/');
    for (const href of hrefs) {
      if (href === '/') continue;
      expect(existsSync(path.join(ROOT, 'src/app', href, 'page.tsx')), href).toBe(true);
    }
  });

  it('carry the footer of §E: Product, Company and Legal, each link once', () => {
    for (const [name, markup] of pages) {
      for (const col of FOOTER_COLUMNS) expect(markup, `${name} ${col.title}`).toContain(`>${col.title}</p>`);
      for (const label of ['About', 'FAQ', 'Contact', 'Privacy notice', 'Data-rights request', 'Suppliers', 'Terms', 'For startups', 'For investors']) expect(textOf(markup), `${name} ${label}`).toContain(label);
    }
  });

  it('show their content with no reveal animation: nothing starts at opacity 0 waiting for a script', () => {
    for (const [name, markup] of pages) { expect(markup, name).not.toContain('data-reveal'); expect(markup, name).not.toMatch(/\bopacity:\s*0\b/); }
  });
});

describe('the pages\' own stylesheet', () => {
  it('hangs every rule under .site, so it beats the landing\'s `.landing *` reset whichever stylesheet loads first', () => {
    // comments out, and the "@media (…) {" openers out too, so a rule that is the first inside a media block is checked like any other
    const css = readFileSync(path.join(ROOT, 'src/components/site/site-page.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    const selectors = [...css.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(20);
    for (const sel of selectors) for (const part of sel.split(',')) expect(part.trim().startsWith('.site '), part.trim()).toBe(true);
  });

  it('is applied by the layout (the .site class is on the wrapper)', () => {
    expect(readFileSync(path.join(ROOT, 'src/components/site/PublicSiteLayout.tsx'), 'utf8')).toContain('${s.landing} ${p.site}');
  });
});
