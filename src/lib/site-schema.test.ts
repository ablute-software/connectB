// Prompt 920 — the JSON-LD of the public site. The schema is invisible, so nothing on screen would show a wrong price, a dangling reference or
// an answer the page does not carry; these tests are the only eyes it has. The properties that matter: it is built from the data the pages
// draw (plans from PLANS, answers from the FAQ module), every reference resolves, every URL is on the canonical host, and it cannot break
// out of its <script>.
import { describe, expect, it } from 'vitest';
import { PLANS } from '@/lib/plans';
import { CONTROLLER_LEGAL_NAME } from '@/lib/controller';
import { allFaqItems, findingInvestmentItems } from '@/content/site/faq';
import { FOR_STARTUPS_STEPS } from '@/content/site/for-startups';
import { INVESTOR_FAQ_EXTRA } from '@/content/site/investors';
import {
  BASE_URL, ORG_ID, aboutPageNode, articleNode, breadcrumbNode, faqPageNode, graph, homeGraph, howToNode, organizationNode,
  plainAnswer, serializeJsonLd, softwareApplicationNode, websiteNode,
} from './site-schema';

type Node = Record<string, unknown>;
const nodes = (g: Node): Node[] => (g['@graph'] as Node[]);
const walk = (v: unknown, visit: (k: string, val: unknown) => void): void => {
  if (Array.isArray(v)) { v.forEach((x) => walk(x, visit)); return; }
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Node)) { visit(k, val); walk(val, visit); }
};

describe('the home graph', () => {
  const g = homeGraph();
  const byType = (t: string) => nodes(g).find((n) => n['@type'] === t)!;

  it('is an Organization, a WebSite and a SoftwareApplication, and survives JSON', () => {
    expect(g['@context']).toBe('https://schema.org');
    expect(nodes(g).map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
    expect(JSON.parse(serializeJsonLd(g))).toEqual(g);
  });

  it('names the operating company and the place (both already public in the Terms) and a contact URL — no email', () => {
    const org = byType('Organization');
    expect(org.name).toBe('Sherlock Deal');
    expect(org.alternateName).toBe('SherlockDeal');
    expect(org.legalName).toBe(CONTROLLER_LEGAL_NAME);
    expect(org.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Viana do Castelo', addressCountry: 'PT' });
    expect(org.contactPoint).toMatchObject({ contactType: 'customer support', url: `${BASE_URL}/contact` });
    expect(JSON.stringify(org)).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no email address anywhere
  });

  it('leaves out what has not been decided or does not exist yet: founder, founding date, sameAs (decision D4) — they are added with a value, never guessed', () => {
    const org = byType('Organization');
    for (const key of ['founder', 'foundingDate', 'sameAs']) expect(org, key).not.toHaveProperty(key);
  });

  it('offers exactly the priced plans, read from PLANS — "Private Detective" has no public price and is not an Offer', () => {
    const offers = (softwareApplicationNode().offers as Node[]);
    expect(offers).toHaveLength(3);
    expect(offers.map((o) => o.name)).toEqual(PLANS.map((p) => p.name));
    expect(offers.map((o) => o.price)).toEqual(PLANS.map((p) => String(p.monthlyEur)));
    for (const o of offers) { expect(o.priceCurrency).toBe('EUR'); expect(String(o.url)).toBe(`${BASE_URL}/#pricing`); }
    expect(JSON.stringify(offers)).not.toContain('Private Detective');
    expect(offers[1].description).toBe(`Per month, or €756 per year.`);
    expect(offers[2].description).toBe(`Per month, or €1,308 per year.`);
  });
});

describe('every graph', () => {
  const graphs: [string, Node][] = [
    ['home', homeGraph()],
    ['for-startups', graph(organizationNode(), websiteNode(), howToNode({ name: 'x', description: 'y', steps: FOR_STARTUPS_STEPS, path: '/for-startups' }), faqPageNode(findingInvestmentItems(), '/for-startups'), breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'For startups', path: '/for-startups' }]))],
    ['faq', graph(organizationNode(), websiteNode(), faqPageNode(allFaqItems(), '/faq'), breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'FAQ', path: '/faq' }]))],
    ['about', graph(organizationNode(), websiteNode(), aboutPageNode({ name: 'About Sherlock Deal', description: 'd', path: '/about' }), breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'About', path: '/about' }]))],
    ['investors', graph(organizationNode(), websiteNode(), articleNode({ headline: 'h', description: 'd', path: '/investors' }), faqPageNode(INVESTOR_FAQ_EXTRA, '/investors'))],
  ];

  for (const [name, g] of graphs) {
    it(`${name}: every {"@id": …} reference points at a node defined in the same graph`, () => {
      const defined = new Set(nodes(g).map((n) => n['@id']).filter(Boolean));
      const refs: string[] = [];
      walk(g['@graph'], (k, v) => {
        if (k === 'publisher' || k === 'author' || k === 'isPartOf' || k === 'about') refs.push((v as Node)['@id'] as string);
      });
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(defined.has(r), `${name}: ${r}`).toBe(true);
    });

    it(`${name}: every URL is on the canonical host`, () => {
      const urls: string[] = [];
      walk(g['@graph'], (k, v) => { if (typeof v === 'string' && /^https?:\/\//.test(v) && k !== '@context') urls.push(v); });
      for (const u of urls) expect(u.startsWith(BASE_URL), u).toBe(true);
    });

    it(`${name}: carries the organisation once, with the id the others point at`, () => {
      const orgs = nodes(g).filter((n) => n['@type'] === 'Organization');
      expect(orgs).toHaveLength(1);
      expect(orgs[0]['@id']).toBe(ORG_ID);
    });
  }
});

describe('FAQPage', () => {
  it('has one Question per question, and each answer is exactly the FAQ text with the link markup removed', () => {
    const items = allFaqItems();
    const page = faqPageNode(items, '/faq');
    const entities = page.mainEntity as Node[];
    expect(entities).toHaveLength(20);
    entities.forEach((e, i) => {
      expect(e['@type']).toBe('Question');
      expect(e.name).toBe(items[i].q);
      expect((e.acceptedAnswer as Node).text).toBe(plainAnswer(items[i].a));
      expect(String((e.acceptedAnswer as Node).text)).not.toMatch(/\]\(|\[/);
    });
  });

  it('plainAnswer keeps the label and drops the address', () => {
    expect(plainAnswer('See [how to find investors](/for-startups). Then [pricing](/#pricing).')).toBe('See how to find investors. Then pricing.');
  });
});

describe('HowTo, Article, AboutPage and breadcrumbs', () => {
  it('HowTo has the five steps in order, numbered from 1', () => {
    const h = howToNode({ name: 'n', description: 'd', steps: FOR_STARTUPS_STEPS, path: '/for-startups' });
    const steps = h.step as Node[];
    expect(steps).toHaveLength(5);
    steps.forEach((s, i) => { expect(s.position).toBe(i + 1); expect(s.name).toBe(FOR_STARTUPS_STEPS[i].name); expect(s.text).toBe(FOR_STARTUPS_STEPS[i].text); });
  });

  it('Article has a headline, both dates and the organisation as author and publisher', () => {
    const a = articleNode({ headline: 'H', description: 'D', path: '/investors' });
    expect(a).toMatchObject({ '@type': 'Article', headline: 'H', author: { '@id': ORG_ID }, publisher: { '@id': ORG_ID } });
    expect(a.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('breadcrumbs are numbered and absolute', () => {
    const b = breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'FAQ', path: '/faq' }]);
    expect(b.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'FAQ', item: `${BASE_URL}/faq` },
    ]);
  });
});

describe('serializeJsonLd', () => {
  it('cannot break out of its <script>, and survives the characters that are line terminators in old JavaScript', () => {
    const data = { a: '</script><script>alert(1)</script>', b: `x${String.fromCharCode(0x2028)}y${String.fromCharCode(0x2029)}z`, c: 'ok' };
    const out = serializeJsonLd(data);
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<');
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(out)).toEqual(data);
  });
});
