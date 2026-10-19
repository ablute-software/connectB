// Prompt 920 — the rules the public copy keeps. The first draft of this text promised "readiness tools" on the Free plan, a fifth matching
// dimension the product does not score ("recent activity"), "most likely to say yes", a reply rate with no source and an advantage in time
// ("first") the product has no mechanism for. Each of those is a sentence a founder could hold Sherlock Deal to, and the Terms (4.4, 4.5)
// say the opposite — so what was corrected stays corrected here, and a number can only enter the copy if the product states it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANS } from '@/lib/plans';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from '@/lib/pipeline-unlock';
import { CONTROLLER_ADDRESS } from '@/lib/controller';
import { allFaqItems, buildFaqGroups, findingInvestmentItems } from './faq';
import { CATALOGUE_FLOOR, COUNTRIES_FLOOR, DEFAULT_DAILY_TARGET, DEFAULT_WEEKLY_TARGET, OPERATOR_LOCALITY } from './facts';
import { ABOUT_META, FAQ_META, FOR_STARTUPS_META, HOME_META, SITEMAP_PAGES } from './pages';
import { FOR_STARTUPS_ANSWER, FOR_STARTUPS_STEPS, LISTS_FAIL, sherlockDoesThisParagraphs } from './for-startups';
import { INVESTOR_FAQ_EXTRA, INVESTOR_FIT_SECTION } from './investors';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** Every sentence of copy the public site says, outside the pages' own markup. */
function allCopy(): string[] {
  return [
    ...allFaqItems().flatMap((i) => [i.q, i.a]),
    FOR_STARTUPS_ANSWER,
    ...LISTS_FAIL.map((l) => `${l.lead} ${l.text}`),
    ...FOR_STARTUPS_STEPS.map((s) => `${s.name}. ${s.text}`),
    ...sherlockDoesThisParagraphs(),
    ...INVESTOR_FAQ_EXTRA.flatMap((i) => [i.q, i.a]),
    INVESTOR_FIT_SECTION.lead,
    ...INVESTOR_FIT_SECTION.cards.map((c) => `${c.title}. ${c.body}`),
    HOME_META.description, FOR_STARTUPS_META.description, ABOUT_META.description, FAQ_META.description,
  ];
}
const sentences = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split(/(?<=[.!?])\s+/).filter(Boolean);

describe('the FAQ', () => {
  const groups = buildFaqGroups();

  it('has the twenty questions of the brief, in five groups, with unique ids', () => {
    expect(groups.map((g) => g.items.length)).toEqual([5, 5, 5, 3, 2]);
    const items = allFaqItems();
    expect(items).toHaveLength(20);
    expect(new Set(items.map((i) => i.id)).size).toBe(20);
    for (const i of items) expect(i.q.endsWith('?'), i.q).toBe(true);
  });

  it('every answer answers in its first sentence — no "it depends" — and says more than one thing', () => {
    for (const i of allFaqItems()) {
      const s = sentences(i.a);
      expect(s.length, i.id).toBeGreaterThanOrEqual(2);
      expect(/it depends|depends on/i.test(s[0]), `${i.id}: first sentence hedges`).toBe(false);
      expect(s[0].length, `${i.id}: first sentence too long to stand alone`).toBeLessThanOrEqual(330);
    }
  });

  it('writes "Sherlock Deal" in full at least once in every group (the name is what separates it from the other Sherlocks)', () => {
    for (const g of groups) expect(g.items.some((i) => i.a.includes('Sherlock Deal')), g.id).toBe(true);
  });

  it('the five questions /for-startups repeats are the FAQ\'s first group, same strings', () => {
    expect(findingInvestmentItems()).toEqual(groups[0].items);
  });

  it('keeps the plan statements honest: nothing readiness- or AI-draft-shaped is promised without "paid plans" beside it', () => {
    for (const i of allFaqItems()) {
      if (/Readiness & Train/.test(i.a)) expect(i.a, `${i.id}: Readiness & Train is a paid-plan tool`).toMatch(/paid plans/);
      if (/AI-personalised/.test(i.a)) expect(i.a, `${i.id}: AI-personalised drafts are a paid-plan tool`).toMatch(/paid plans/);
    }
    const free = allFaqItems().find((i) => i.id === 'free-plan')!;
    const [freePart] = free.a.split('The paid plans');
    expect(freePart).not.toMatch(/Readiness|AI-personalised|team seats|seats/);
    // and it is the product's own: every name, price and quota is read from plans.ts / pipeline-unlock.ts, not typed
    for (const p of PLANS) { expect(free.a).toContain(p.name); expect(free.a).toContain(`€${p.monthlyEur}`); }
    expect(free.a).toContain(`up to ${PLAN_PIPELINE_MONTHLY_ADDITION.idea} new curated investors a month`);
  });
});

describe('what the copy must never say', () => {
  const copy = allCopy();
  const FORBIDDEN: [RegExp, string][] = [
    [/most likely to say yes/i, 'promises an outcome the product does not measure (Terms 4.5: indicative only)'],
    [/five (dimensions|criteria)/i, 'the founder-side score has four dimensions; investors have five (with instrument)'],
    [/score[sd]?[^.]*recent activity|recent activity[^.]*score/i, 'recent activity is advice to founders, not something Sherlock Deal scores'],
    [/before (anyone|everyone) else|first[- ]mover|exclusive(ly)?|ahead of (the )?(competition|others)/i, 'there is no exclusivity or time advantage mechanism'],
    [/sells? (your |its )?contacts|does not sell contacts/i, 'the product delivers published contact channels inside the subscription'],
    [/\d\s?%/, 'no percentage: none is sourced'],
    [/20[–-]40/, 'the "20–40% reply" claim has no source'],
    [/guaranteed|we guarantee/i, 'no promise of an outcome'],
  ];
  for (const [re, why] of FORBIDDEN) {
    it(`never says ${re}`, () => {
      const hits = copy.filter((t) => re.test(t));
      expect(hits, why).toEqual([]);
    });
  }

  it('says "guarantee" only to deny it', () => {
    for (const t of copy) for (const s of sentences(t)) if (/guarantee/i.test(s) && !s.endsWith('?')) expect(s, s).toMatch(/\b(not|cannot|never|no)\b/i);
  });

  it('every digit in the copy is a number the product or facts.ts states — nothing is typed in that the product could contradict', () => {
    const allowed = new Set<string>([
      String(CATALOGUE_FLOOR), String(COUNTRIES_FLOOR), String(DEFAULT_DAILY_TARGET), String(DEFAULT_WEEKLY_TARGET),
      ...Object.values(PLAN_PIPELINE_MONTHLY_ADDITION).map(String),
      ...PLANS.map((p) => String(p.monthlyEur)),
      '20', // "a 20-minute call" — advice, not a claim about the product
    ]);
    const stray: string[] = [];
    for (const t of copy) for (const m of t.matchAll(/\d[\d,]*/g)) if (!allowed.has(m[0])) stray.push(`${m[0]} in "${t.slice(0, 70)}…"`);
    expect(stray).toEqual([]);
  });
});

describe('the facts the copy leans on', () => {
  it('the default outreach targets are the database defaults', () => {
    const sql = read('supabase/migrations/0001_init.sql');
    expect(sql).toMatch(new RegExp(`daily_cap int not null default ${DEFAULT_DAILY_TARGET}`));
    expect(sql).toMatch(new RegExp(`weekly_cap int not null default ${DEFAULT_WEEKLY_TARGET}`));
  });

  it('"500+ … 25+" is what /investors already says (one statement of the catalogue, not two)', () => {
    const page = read('src/app/investors/page.tsx');
    expect(page).toContain(`${CATALOGUE_FLOOR}+ investor profiles`);
    expect(page).toContain(`${COUNTRIES_FLOOR}+ European`);
  });

  it('the operating company sits where the Terms say it does', () => {
    expect(CONTROLLER_ADDRESS).toContain(OPERATOR_LOCALITY);
  });
});

describe('how the existing pages carry the additions (the pages themselves need a session and next/font, so the wiring is pinned at the source)', () => {
  const home = read('src/app/page.tsx');
  const investors = read('src/app/investors/page.tsx');
  const toggle = read('src/components/landing/AudienceToggle.tsx');

  it('the home takes its title and description from the approved text and carries the schema — and its visible copy is the landing\'s own', () => {
    expect(home).toContain('const TITLE = HOME_META.title;');
    expect(home).toContain('const DESCRIPTION = HOME_META.description;');
    expect(home).toContain('<JsonLd data={homeGraph()} />');
    // the landing's own words are still there (Prompt 920 changes metadata and three approved touches, nothing else)
    for (const kept of ['Crack the case on your <em>fundraise.</em>', 'Everything a raise needs, nothing it doesn&apos;t', 'Three steps to a round under control', 'Your numbers, confirmed once. Consistent everywhere.', 'The game is afoot.', 'Every investor, every conversation, every confirmed fact']) {
      expect(home, kept).toContain(kept);
    }
  });

  it('the home gained exactly the three approved visible touches: the toggle target, one line under the H1, two footer links', () => {
    expect(toggle).toContain('href="/for-startups"');
    expect(toggle).toContain('href="/investors"');
    expect(home).toContain('matches startups with the investors that fit them, and puts startups that match their mandate in front of investors.');
    expect(home).toContain('<Link href="/about">About</Link>');
    expect(home).toContain('<Link href="/faq">FAQ</Link>');
  });

  it('/investors keeps its four questions, adds the three, and builds the FAQPage from the whole list', () => {
    expect(investors.match(/\{ q: '/g) ?? []).toHaveLength(4);
    expect(INVESTOR_FAQ_EXTRA).toHaveLength(3);
    expect(investors).toContain('const FAQS = [...EXISTING_FAQS, ...INVESTOR_FAQ_EXTRA];');
    expect(investors).toContain("faqPageNode(FAQS, '/investors')");
    expect(investors).toContain('FAQS.map((f) =>');
  });

  it('/investors draws the new section from the approved text, between the access splits and the pricing', () => {
    expect(investors).toContain('INVESTOR_FIT_SECTION.cards.map');
    const order = ['============ TRUST SPLIT ============', '============ FIRST CONTACT ============', '============ PRICING ============'].map((m) => investors.indexOf(m));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the landing\'s stylesheet is not part of this change (new pages have their own)', () => {
    expect(read('src/components/site/site-page.module.css')).toContain('A NEW file: nothing in landing.module.css is changed');
  });
});

describe('titles and descriptions', () => {
  const metas = [HOME_META, FOR_STARTUPS_META, ABOUT_META, FAQ_META];
  it('every title starts with the brand (it disambiguates the name) and every description fits a result snippet', () => {
    for (const m of metas) {
      expect(m.title.startsWith('Sherlock Deal — '), m.title).toBe(true);
      expect(m.description.length, m.title).toBeLessThanOrEqual(160);
      expect(m.description).not.toMatch(/\s{2,}/);
    }
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length);
  });

  it('the home description says four things matched, not five, and does not promise a yes', () => {
    expect(HOME_META.description).toContain('sector, stage, ticket size and geography');
    expect(HOME_META.description).not.toMatch(/likely|first contact|recent activity/i);
  });

  it('the sitemap list has the home first and no duplicate path', () => {
    expect(SITEMAP_PAGES[0].path).toBe('/');
    expect(new Set(SITEMAP_PAGES.map((p) => p.path)).size).toBe(SITEMAP_PAGES.length);
  });
});
