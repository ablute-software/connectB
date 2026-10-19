// Prompt 920 addendum (19/10/2026) — the Open Graph images, the metadata defaults, and the accessibility structure of the landing pages.
//
// None of this is visible in a unit test's natural field of view: an Open Graph image is a file a crawler fetches, a <main> landmark is a tag
// nobody sees, and a contrast ratio of 4.47 instead of 4.5 looks like the same colour. Each is pinned here at its source, with the numbers
// Lighthouse measured on production on 19/10/2026 written next to the thing they justify.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('from=investors'),
  usePathname: () => '/contact',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
}));

import { HOME_CLAIM, HOME_META, OG_DEFAULT_IMAGE, OG_HOME } from '@/content/site/pages';
import { INVESTOR_FIT_SECTION, OG_INVESTORS } from '@/content/site/investors';
import ContactPage, { metadata as contactMetadata } from '@/app/contact/page';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('Open Graph images', () => {
  const CARDS = [
    { dir: 'src/app', text: OG_HOME, altPrefix: 'Sherlock Deal — ' },
    { dir: 'src/app/investors', text: OG_INVESTORS, altPrefix: 'Sherlock Deal for investors — ' },
  ] as const;

  // JPEG size = the first start-of-frame marker (SOF0/SOF2): [FF C0|C2] len(2) precision(1) height(2) width(2)
  const jpegSize = (buf: Buffer) => {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    throw new Error('no SOF marker');
  };

  it.each(CARDS)('$dir: a real 1200x630 JPEG under 300 KB (WhatsApp drops a preview image much above that), with the alt text Next serves as og:image:alt', ({ dir, text, altPrefix }) => {
    const file = join(process.cwd(), dir, 'opengraph-image.jpg');
    expect(existsSync(file)).toBe(true);
    const img = readFileSync(file);
    expect(img.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(jpegSize(img)).toEqual({ width: 1200, height: 630 });
    expect(img.length).toBeLessThan(300 * 1024);
    // the .alt.txt is exactly the card's words: a copy change fails here until scripts/render-og-images.mjs is run again
    expect(read(join(dir, 'opengraph-image.alt.txt'))).toBe(`${altPrefix}${text.headline}`);
  });

  it('the script that draws them says what the content modules say (so a text change cannot ship with a stale picture)', () => {
    const script = read('scripts/render-og-images.mjs');
    const headlines = [...script.matchAll(/headlineHtml: '([^']*)'/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    const subs = [...script.matchAll(/^\s*sub: '([^']*)'/gm)].map((m) => m[1]);
    expect(headlines).toEqual([OG_HOME.headline, OG_INVESTORS.headline]);
    expect(subs).toEqual([OG_HOME.sub, OG_INVESTORS.sub]);
  });

  it('home: the claim of its <title>, and the four criteria its description already states', () => {
    expect(HOME_META.title).toBe(`Sherlock Deal — ${HOME_CLAIM}`);
    expect(OG_HOME.headline).toBe(`${HOME_CLAIM}.`);
    expect(HOME_META.description).toContain('sector, stage, ticket size and geography');
    expect(OG_HOME.sub).toContain('sector, stage, ticket size and geography');
  });

  it('/investors: taken from the section the page already carries, not invented', () => {
    expect(INVESTOR_FIT_SECTION.lead).toContain('before anyone sends you a deck');
    expect(OG_INVESTORS.headline).toContain('before anyone sends you a deck');
    for (const w of ['sectors', 'stages', 'cheque range', 'geographies', 'instruments']) {
      expect(INVESTOR_FIT_SECTION.lead).toContain(w);
      expect(OG_INVESTORS.sub).toContain(w);
    }
  });

  // next/og (@vercel/og) locates its bundled font with path.join(import.meta.url, …), which on Windows turns the file:/// URL into a backslash path and
  // throws "Invalid URL" in `next build` (19/10/2026, Next 14.2.35). This project's gate is a local build, so a generated image would stop it.
  it('no source file draws an image with next/og: the cards are files', () => {
    const walk = (d: string): string[] => readdirSync(join(process.cwd(), d)).flatMap((e) => (statSync(join(process.cwd(), d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
    const users = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)).filter((f) => /from 'next\/og'/.test(read(f)));
    expect(users).toEqual([]);
  });
});

describe('metadata: the large card everywhere, and defaults that say what the home says', () => {
  it('every public page asks for the large card (summary_large_image)', () => {
    for (const f of ['src/app/page.tsx', 'src/app/investors/page.tsx', 'src/app/for-startups/page.tsx', 'src/app/about/page.tsx', 'src/app/faq/page.tsx', 'src/app/contact/page.tsx']) {
      expect(read(f), f).toMatch(/twitter: \{ card: 'summary_large_image'/);
    }
  });

  // A page that declares its own `openGraph` object REPLACES the root's file-based image (Next merges metadata shallowly) — found on the built HTML
  // on 19/10/2026: the home, /investors and /login had an og:image, /for-startups, /about, /faq and /contact had none. So those four name it.
  it('the pages that declare their own openGraph name the default card in it and in twitter, so they are not shared as a bare link', () => {
    for (const f of ['src/app/for-startups/page.tsx', 'src/app/about/page.tsx', 'src/app/faq/page.tsx', 'src/app/contact/page.tsx']) {
      const src = read(f);
      expect(src, f).toContain('images: [OG_DEFAULT_IMAGE]');
      expect(src, f).toContain('images: [{ url: OG_DEFAULT_IMAGE.url, alt: OG_DEFAULT_IMAGE.alt }]');
    }
    expect(OG_DEFAULT_IMAGE.url).toBe('/opengraph-image.jpg'); // the route Next serves for src/app/opengraph-image.jpg
    expect(existsSync(join(process.cwd(), 'src/app/opengraph-image.jpg'))).toBe(true);
    expect(OG_DEFAULT_IMAGE).toMatchObject({ width: 1200, height: 630, alt: `Sherlock Deal — ${OG_HOME.headline}` });
  });

  it('the root layout\'s defaults (login, signup, the app) are the home\'s approved title and description, resolved on the canonical domain', () => {
    const l = read('src/app/layout.tsx');
    expect(l).toContain('metadataBase: new URL(APP_URL)');
    expect(l).toContain('title: HOME_META.title');
    expect(l).toContain('description: HOME_META.description');
    // the positioning before the public site was rewritten must not come back through the defaults
    expect(l).not.toContain('Investor Relations Management platform');
    expect(l).not.toContain('— Investor Relations`');
  });
});

describe('accessibility structure of the landing pages', () => {
  const css = read('src/app/landing.module.css');

  it.each(['src/app/page.tsx', 'src/app/investors/page.tsx'])('%s has exactly one <main> (Lighthouse landmark-one-main), between the nav and the footer', (f) => {
    const src = read(f);
    // the JSX tags, each on a line of its own (the comment above the opening one says the word "<main>" too)
    expect(count(src, /^\s*<main>\s*$/gm)).toBe(1);
    expect(count(src, /^\s*<\/main>\s*$/gm)).toBe(1);
    expect(src.search(/^\s*<main>\s*$/m)).toBeGreaterThan(src.indexOf('</nav>'));
    expect(src.search(/^\s*<\/main>\s*$/m)).toBeLessThan(src.indexOf('<footer'));
  });

  it('the new public pages\' layout has its <main> too', () => {
    expect(count(read('src/components/site/PublicSiteLayout.tsx'), /<main /g)).toBe(1);
  });

  it('the home\'s mock column titles are not headings: an <h4> straight after the <h2>s skipped a level (Lighthouse heading-order)', () => {
    expect(read('src/app/page.tsx')).not.toMatch(/<h4/);
    expect(css).toContain('.col .colTitle { font-family');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.col h4/); // (the comment above the rule says what it used to be)
  });

  // WCAG relative luminance, so the numbers in the comments are checked and not just believed.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg: string, bg: string) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

  it('the 2% tone tweaks clear WCAG AA (4.5:1) where Lighthouse measured the originals just under it', () => {
    expect(ratio('#5b7077', '#e3f0f2')).toBeLessThan(4.5);   // --muted on --teal-soft: 4.47, the audience toggle in its white-nav state
    expect(ratio('#596e75', '#e3f0f2')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#2a7f8e', '#f7fafa')).toBeLessThan(4.5);   // --teal on --bg: 4.42, an eyebrow
    expect(ratio('#297c8b', '#f7fafa')).toBeGreaterThanOrEqual(4.5);
    // …and they are where they are claimed to be
    expect(read('src/components/site/PublicSiteLayout.tsx')).toContain("'--muted': '#596e75'");
    expect(css).toContain('.firstContact .eyebrow { color: #297c8b; }');
    expect(read('src/app/investors/page.tsx')).toContain('${s.sec} ${s.firstContact}');
  });
});

describe('/contact', () => {
  it('is a server component with a title and description of its own, not the layout\'s generic ones', () => {
    expect(read('src/app/contact/page.tsx')).not.toMatch(/^'use client'/m);
    expect(contactMetadata.title).toBe('Sherlock Deal — Contact');
    expect(String(contactMetadata.description)).toContain('we read every message');
    expect(contactMetadata.alternates?.canonical).toBe('/contact');
  });

  it('puts a heading, the text and the form in the HTML itself, and labels the category <select> (Lighthouse select-name)', () => {
    const html = renderToStaticMarkup(createElement(ContactPage));
    expect(html).toContain('<h1 class="sr-only">Contact Sherlock Deal</h1>');
    expect(html).toContain('Got a question, found a bug');
    expect(html).toMatch(/<select[^>]*aria-label="Category"/);
    expect(html).toContain('placeholder="How can we help?"');
  });

  it('the form is also the fallback of the one boundary that waits for the query string, so it is in the first byte of the page', () => {
    const src = read('src/app/contact/page.tsx');
    expect(src).toContain('<Suspense fallback={<ContactForm source="landing" />}>');
    expect(read('src/components/ContactFormForVisitor.tsx')).toContain("sp.get('from') === 'investors' ? 'landing_investors' : 'landing'");
  });
});
