// Prompt 920 — the JSON-LD of the public site: one place builds every node, from the same data the pages draw. Invisible markup (a
// <script type="application/ld+json">), zero effect on how a page looks.
//
// What is deliberately NOT here until Nuno supplies it (decision D4, docs/site-copy-920.md): `foundingDate`, `founder`, and `sameAs`
// (Wikidata, Crunchbase, Dealroom, LinkedIn — they go in once the entries exist). A schema that guesses is worse than one that is short.
//
// Prices and plan names come from PLANS, so the schema can never say a number the pricing section does not; the FAQ answers come from the
// FAQ module with the link markup removed, so the schema can never describe text the page does not show (site-schema.test.ts compares them).
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import { PLANS, type PlanRow } from '@/lib/plans';
import { CONTROLLER_LEGAL_NAME } from '@/lib/controller';
import { OPERATOR_LOCALITY, SITE_CONTENT_UPDATED } from '@/content/site/facts';

export const BASE_URL = APP_URL.replace(/\/+$/, '');
export const ORG_ID = `${BASE_URL}/#organization`;
export const WEBSITE_ID = `${BASE_URL}/#website`;
const SITE_DESCRIPTION = 'Sherlock Deal is a fundraising workspace and matching platform that connects startups with the investors that fit them, built in Portugal for Europe.';

type Json = Record<string, unknown>;
export const abs = (path: string): string => `${BASE_URL}${path}`;

export function organizationNode(): Json {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: BRAND_NAME,
    alternateName: 'SherlockDeal',
    legalName: CONTROLLER_LEGAL_NAME,
    url: BASE_URL,
    logo: abs('/icon.svg'),
    description: SITE_DESCRIPTION,
    address: { '@type': 'PostalAddress', addressLocality: OPERATOR_LOCALITY, addressCountry: 'PT' },
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', url: abs('/contact') },
  };
}

export function websiteNode(): Json {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: BRAND_NAME,
    alternateName: 'SherlockDeal',
    url: BASE_URL,
    inLanguage: 'en',
    publisher: { '@id': ORG_ID },
  };
}

const withThousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function offerNode(p: PlanRow): Json {
  return {
    '@type': 'Offer',
    name: p.name,
    price: String(p.monthlyEur),
    priceCurrency: 'EUR',
    url: abs('/#pricing'),
    description: p.paid && p.annualEur ? `Per month, or €${withThousands(p.annualEur)} per year.` : 'Free plan, no card required.',
  };
}

/** The three priced plans. "Private Detective" has no public price (custom terms), so it is not an Offer. */
export function softwareApplicationNode(): Json {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${BASE_URL}/#application`,
    name: BRAND_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: BASE_URL,
    description: 'Matches startups with investors by sector, stage, ticket size and geography, and runs the outreach pipeline, the data room and the readiness work of a fundraising round.',
    publisher: { '@id': ORG_ID },
    offers: PLANS.map(offerNode),
  };
}

/** Organization + WebSite + SoftwareApplication — the home page. */
export function homeGraph(): Json {
  return graph(organizationNode(), websiteNode(), softwareApplicationNode());
}

export function graph(...nodes: Json[]): Json {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** "[label](href)" → "label": what the schema says is what a reader reads, minus the link markup. */
export function plainAnswer(answer: string): string {
  return answer.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function faqPageNode(items: { q: string; a: string }[], path: string): Json {
  return {
    '@type': 'FAQPage',
    '@id': `${abs(path)}#faq`,
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: plainAnswer(i.a) },
    })),
  };
}

export function howToNode(args: { name: string; description: string; steps: { name: string; text: string }[]; path: string }): Json {
  return {
    '@type': 'HowTo',
    '@id': `${abs(args.path)}#howto`,
    name: args.name,
    description: args.description,
    step: args.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text })),
  };
}

/**
 * Google's Rich Results Test reads a bare date ("2026-10-16") as an invalid date-time with no time zone (16/10/2026: four optional-field
 * warnings on the Article). The DAY is the fact we know; the time is nominal. Noon UTC keeps the same calendar day in every time zone from
 * UTC-12 to UTC+11, which is why it is noon and not midnight.
 */
export function asDateTime(day: string): string {
  return `${day}T12:00:00Z`;
}

export function articleNode(args: { headline: string; description: string; path: string }): Json {
  return {
    '@type': 'Article',
    '@id': `${abs(args.path)}#article`,
    headline: args.headline,
    description: args.description,
    inLanguage: 'en',
    datePublished: asDateTime(SITE_CONTENT_UPDATED),
    dateModified: asDateTime(SITE_CONTENT_UPDATED),
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(args.path) },
  };
}

export function aboutPageNode(args: { name: string; description: string; path: string }): Json {
  return {
    '@type': 'AboutPage',
    '@id': `${abs(args.path)}#webpage`,
    url: abs(args.path),
    name: args.name,
    description: args.description,
    inLanguage: 'en',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORG_ID },
  };
}

export function breadcrumbNode(trail: { name: string; path: string }[]): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: abs(t.path) })),
  };
}

/**
 * JSON for a <script type="application/ld+json">: "<" is escaped so no string can ever close the tag (the content is ours, but the rule
 * costs nothing); U+2028 and U+2029 are escaped too — valid in JSON, line terminators in older JavaScript.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(LINE_SEPARATOR, '\\u2028').replace(PARAGRAPH_SEPARATOR, '\\u2029');
}
