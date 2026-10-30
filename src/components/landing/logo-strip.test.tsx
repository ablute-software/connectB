// Prompt 926 (30/10/2026) — what the strip of logos puts in the page: one labelled region announced once, the logos read by the company's name, the copies for the
// seam hidden from assistive technology, no links, and nothing at all below six logos. (The motion itself is checked in a real browser: logo-strip.browser.test.ts.)
// Every logo here is invented (zz-test-*).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The stylesheet is a CSS module; under test its class names are their own names, so the markup can be read without hashes.
vi.mock('@/app/landing.module.css', () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }));

// The React that vitest renders with (18.3.1) does not know `fetchPriority` yet — the one inside Next does — and says so on the console for every render.
const realError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].includes('fetchPriority')) return; realError(...args); }; });
afterAll(() => { console.error = realError; });

import { LOGO_STRIP_LABEL, LOGO_STRIP_LOOP_SECONDS, LOGO_STRIP_SIZES } from '@/content/site/logo-strip';
import { LOGO_STRIP_MIN, loopCopies, type LandingLogo } from '@/lib/landing-logos';
import { LOGO_FOLDER, LogoStrip } from './LogoStrip';

const logo = (n: number, over: Partial<LandingLogo> = {}): LandingLogo => ({
  name: `zz-test-${n}`, file: `zz-test-${n}.svg`, width: 120 + n, height: 40, pages: 'both', order: n, authorization: { date: '2026-10-29', form: 'email' }, ...over,
});
const many = (k: number) => Array.from({ length: k }, (_, i) => logo(i + 1));
const render = (props: Partial<Parameters<typeof LogoStrip>[0]> & { logos: readonly LandingLogo[] }) => renderToStaticMarkup(createElement(LogoStrip, { page: 'startups', ...props }));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('the strip appears only with enough logos', () => {
  it.each([0, 1, 5])('%i logos: nothing at all (the last gate before the public sees a name)', (n) => {
    expect(render({ logos: many(n) })).toBe('');
  });

  it(`${LOGO_STRIP_MIN} logos: a strip`, () => {
    expect(render({ logos: many(LOGO_STRIP_MIN) })).toContain('data-logo-strip="startups"');
  });
});

describe('what the strip says', () => {
  const html = render({ logos: many(8) });

  it('is one region with a name, so assistive technology announces it once; the visible line above the logos is hidden from it (the name already says it)', () => {
    expect(count(html, /<section\b/g)).toBe(1);
    expect(html).toContain(`aria-label="${LOGO_STRIP_LABEL.startups}"`);
    expect(html).toMatch(new RegExp(`<p class="logoLabel" aria-hidden="true">${LOGO_STRIP_LABEL.startups}</p>`));
  });

  it('the words above it are the brief\'s proposals, one per page, and the investors page names only startups', () => {
    expect(LOGO_STRIP_LABEL.startups).toBe('Startups that trust us');
    expect(LOGO_STRIP_LABEL.investors).toBe('Startups that trust us');
    const investors = render({ page: 'investors', logos: many(6) });
    expect(investors).toContain('data-logo-strip="investors"');
    expect(investors).toContain(`aria-label="${LOGO_STRIP_LABEL.investors}"`);
    expect(investors).not.toContain('investors already');
  });

  it('the first copy of the list is for people: each logo is an image whose alternative text is the company\'s name, with its own width and height written on it', () => {
    const first = html.split('<ul')[1];
    expect(count(first, /<li\b/g)).toBe(8);
    for (let n = 1; n <= 8; n++) {
      expect(first).toContain(`<img class="logoImg" src="${LOGO_FOLDER}zz-test-${n}.svg" alt="zz-test-${n}" width="${120 + n}" height="40"`);
    }
    expect(first).not.toContain('aria-hidden');
  });

  it('every other copy is aria-hidden and its images have empty alternative text, so nothing is read twice', () => {
    const copies = loopCopies(many(8), LOGO_STRIP_SIZES);
    expect(copies).toBeGreaterThanOrEqual(2);
    expect(count(html, /<ul\b/g)).toBe(copies);
    expect(count(html, /<ul[^>]*aria-hidden="true"/g)).toBe(copies - 1);
    const hidden = html.split('<ul').slice(2).join('<ul');
    expect(count(hidden, /<img\b/g)).toBe(8 * (copies - 1));
    expect(count(hidden, /alt=""/g)).toBe(8 * (copies - 1));
    expect(hidden).not.toMatch(/alt="zz-test/);
    // so a company's name is in the page exactly once for a screen reader
    for (let n = 1; n <= 8; n++) expect(count(html, new RegExp(`alt="zz-test-${n}"`, 'g'))).toBe(1);
  });

  it('has no links and nothing to click or tab to: a logo here is a statement, not a door', () => {
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toContain('href=');
    expect(html).not.toMatch(/tabindex|onclick|<button/i);
  });

  it('every image has its width and height, so the space is reserved before the file arrives (no layout shift), and asks to be fetched last', () => {
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img).toMatch(/\swidth="\d+"/);
      expect(img).toMatch(/\sheight="\d+"/);
      expect(img).toMatch(/\sfetchpriority="low"/i);
      expect(img).toContain('decoding="async"');
    }
  });

  it('hands the sizes, the copies and the time of one turn to the stylesheet as custom properties, from the constants Nuno can edit', () => {
    expect(html).toContain(`--logo-h:${LOGO_STRIP_SIZES.height}px`);
    expect(html).toContain(`--logo-gap:${LOGO_STRIP_SIZES.gap}px`);
    expect(html).toContain(`--logo-maxw:${LOGO_STRIP_SIZES.maxWidth}px`);
    expect(html).toContain(`--logo-h-phone:${LOGO_STRIP_SIZES.heightPhone}px`);
    expect(html).toContain(`--logo-copies:${loopCopies(many(8), LOGO_STRIP_SIZES)}`);
    expect(html).toContain(`--logo-loop:${LOGO_STRIP_LOOP_SECONDS}s`);
    expect(render({ logos: many(8), loopSeconds: 33 })).toContain('--logo-loop:33s');
  });

  it('one turn is between 30 and 45 seconds, as the brief asks', () => {
    expect(LOGO_STRIP_LOOP_SECONDS).toBeGreaterThanOrEqual(30);
    expect(LOGO_STRIP_LOOP_SECONDS).toBeLessThanOrEqual(45);
  });

  it('a name with markup in it is text, never markup', () => {
    const evil = render({ logos: [...many(5), logo(6, { name: 'zz-test <b onmouseover="x()">&"' })] });
    expect(evil).not.toContain('<b ');
    expect(evil).toContain('alt="zz-test &lt;b onmouseover=&quot;x()&quot;&gt;&amp;&quot;"');
  });
});
