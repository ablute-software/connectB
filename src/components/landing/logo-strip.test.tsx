// Prompt 926 (30/10/2026; carousel back 31/10/2026, Nuno) — what the carousel of logos puts in the page: one region named by its visible title (an <h2>) that says the logos are EXAMPLES, every company read once by
// a screen reader and the technical copies of the list hidden from it, no links, and nothing at all below six logos. The size of each logo and the speed are pure functions, pinned here too. (The movement
// itself, the edges, the pause and "reduce motion" are checked in a real browser: logo-strip.browser.test.ts.) Every logo here is invented (zz-test-*).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The stylesheet is a CSS module; under test its class names are their own names, so the markup can be read without hashes.
vi.mock('@/app/landing.module.css', () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }));

// The React that vitest renders with (18.3.1) does not know `fetchPriority` yet — the one inside Next does — and says so on the console for every render.
const realError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].includes('fetchPriority')) return; realError(...args); }; });
afterAll(() => { console.error = realError; });

import { LOGO_STRIP_FADE, LOGO_STRIP_LABEL, LOGO_STRIP_SIZES, LOGO_STRIP_SPEED } from '@/content/site/logo-strip';
import { LOGO_STRIP_MIN, LOOP_COPIES, listWidth, logoBoxes, logoWindows, loopSeconds, noRepeatWindow, type LandingLogo, type LogoSizing } from '@/lib/landing-logos';
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

  it(`${LOGO_STRIP_MIN} logos: the section`, () => {
    expect(render({ logos: many(LOGO_STRIP_MIN) })).toContain('data-logo-strip="startups"');
  });
});

describe('what the section says', () => {
  const html = render({ logos: many(8) });

  it('is one region named by its visible title: an <h2>, centred above the carousel, inside the same section (no separate band)', () => {
    expect(count(html, /<section\b/g)).toBe(1);
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(html).toContain('aria-labelledby="logo-strip-title-startups"');
    expect(html).toContain(`<h2 id="logo-strip-title-startups" class="logoTitle">${LOGO_STRIP_LABEL.startups}</h2>`);
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('class="logoWindow"'));
    // the title is before the window and outside the track that moves: it never moves with the logos
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('class="logoTrack"'));
    expect(html.slice(html.indexOf('class="logoTrack"'))).not.toContain('<h2');
  });

  it('the title, one per page, says EXAMPLES (Nuno, 31/10/2026): the startups page says some of the startups are already on the platform; the investors page says a selection from the 500+ profiles of the database — never that they are all active users', () => {
    expect(LOGO_STRIP_LABEL.startups).toBe('Some of the startups already on Sherlock Deal');
    expect(LOGO_STRIP_LABEL.investors).toBe('A selection from 500+ investor profiles in our database');
    const investors = render({ page: 'investors', logos: many(6) });
    expect(investors).toContain('data-logo-strip="investors"');
    expect(investors).toContain('aria-labelledby="logo-strip-title-investors"');
    expect(investors).toContain(`>${LOGO_STRIP_LABEL.investors}</h2>`);
    expect(investors).not.toMatch(/startups/i);
    expect(render({ page: 'startups', logos: many(6) })).not.toContain('investor profiles');
    // neither title reads as "this is the whole list"; the investors' one gives the size of the database and does not claim use of the platform
    for (const t of Object.values(LOGO_STRIP_LABEL)) expect(t).toMatch(/some of|a selection/i);
    expect(LOGO_STRIP_LABEL.investors).not.toMatch(/already on|trust|use us|users|platform/i);
  });

  it('the first copy of the list is for people: each logo is an image whose alternative text is the company\'s name, with its own width and height written on it', () => {
    const first = html.split('<ul')[1];
    expect(count(first, /<li\b/g)).toBe(8);
    for (let n = 1; n <= 8; n++) {
      expect(first).toContain(`<img class="logoImg" src="${LOGO_FOLDER}zz-test-${n}.svg" alt="zz-test-${n}" width="${120 + n}" height="40"`);
    }
    expect(first).not.toContain('aria-hidden');
  });

  it('every other copy (the same logos again, only so the movement has no seam and no jump) is aria-hidden and its images have empty alternative text, so nothing is read twice and no company is invented', () => {
    const copies = LOOP_COPIES;
    expect(copies).toBe(2);
    expect(count(html, /<ul\b/g)).toBe(copies);
    expect(count(html, /<ul[^>]*aria-hidden="true"/g)).toBe(copies - 1);
    const hidden = html.split('<ul').slice(2).join('<ul');
    expect(count(hidden, /<img\b/g)).toBe(8 * (copies - 1));
    expect(count(hidden, /alt=""/g)).toBe(8 * (copies - 1));
    expect(hidden).not.toMatch(/alt="zz-test/);
    // a company's name is in the page exactly once for a screen reader, and the copies hold no logo the first list does not
    for (let n = 1; n <= 8; n++) expect(count(html, new RegExp(`alt="zz-test-${n}"`, 'g'))).toBe(1);
    const files = (s: string) => [...s.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(files(html))).toEqual(new Set(files(html.split('<ul')[1])));
  });

  it('is ONE row: one track, one list per copy, no grid, no wrapping container', () => {
    expect(count(html, /class="logoTrack"/g)).toBe(1);
    expect(count(html, /class="logoWindow"/g)).toBe(1);
    expect(html).not.toMatch(/logoBreak|logoFrame|data-logo-rows/);
  });

  it('has no links and nothing to click or tab to: a logo here is a statement, not a door', () => {
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toContain('href=');
    expect(html).not.toMatch(/tabindex|onclick|<button/i);
  });

  it('every image has its width and height, so the space is reserved before the file arrives (no layout shift), is fetched last, and is NOT lazy (a logo outside the window would load just as it slides in)', () => {
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img).toMatch(/\swidth="\d+"/);
      expect(img).toMatch(/\sheight="\d+"/);
      expect(img).toMatch(/\sfetchpriority="low"/i);
      expect(img).toContain('decoding="async"');
      expect(img).not.toContain('loading="lazy"');
    }
  });

  it('hands the gaps, the window, the fade, the copies and the time of one turn at each layout to the stylesheet as custom properties, from the constants Nuno can edit; every logo carries its width on a laptop (--w) and on a phone (--wp)', () => {
    expect(html).toContain(`--logo-gap:${LOGO_STRIP_SIZES.desktop.gap}px`);
    expect(html).toContain(`--logo-gap-phone:${LOGO_STRIP_SIZES.phone.gap}px`);
    expect(html).toContain(`--logo-maxh:${LOGO_STRIP_SIZES.desktop.maxHeight}px`);
    expect(html).toContain(`--logo-maxh-phone:${LOGO_STRIP_SIZES.phone.maxHeight}px`);
    expect(html).toContain(`--logo-window:${noRepeatWindow(many(8), LOGO_STRIP_SIZES.desktop)}px`);
    expect(html).toContain(`--logo-window-phone:${noRepeatWindow(many(8), LOGO_STRIP_SIZES.phone)}px`);
    expect(html).toContain(`--logo-fade:${LOGO_STRIP_FADE.desktop}px`);
    expect(html).toContain(`--logo-fade-phone:${LOGO_STRIP_FADE.phone}px`);
    expect(render({ logos: many(8), fade: { desktop: 30, phone: 10 } })).toContain('--logo-fade:30px;--logo-fade-phone:10px');
    expect(html).toContain(`--logo-copies:${LOOP_COPIES}`);
    expect(html).toContain(`--logo-loop:${loopSeconds(many(8), LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SPEED)}s`);
    expect(html).toContain(`--logo-loop-phone:${loopSeconds(many(8), LOGO_STRIP_SIZES.phone, LOGO_STRIP_SPEED)}s`);
    expect(render({ logos: many(8), pxPerSecond: 64 })).toContain(`--logo-loop:${loopSeconds(many(8), LOGO_STRIP_SIZES.desktop, 64)}s`);
    const d = logoBoxes(many(8), LOGO_STRIP_SIZES.desktop);
    const p = logoBoxes(many(8), LOGO_STRIP_SIZES.phone);
    d.forEach((b, i) => { expect(html).toContain(`--w:${b.width};--wp:${p[i].width}`); });
  });

  it('a name with markup in it is text, never markup', () => {
    const evil = render({ logos: [...many(5), logo(6, { name: 'zz-test <b onmouseover="x()">&"' })] });
    expect(evil).not.toContain('<b ');
    expect(evil).toContain('alt="zz-test &lt;b onmouseover=&quot;x()&quot;&gt;&amp;&quot;"');
  });
});

describe('the same constant speed on every screen (Nuno, 31/10/2026: "velocidade visual constante e moderada, independentemente da resolução")', () => {
  const shapes = [[405, 162], [405, 165], [405, 183], [405, 172], [405, 80], [404, 97], [374, 253], [405, 110], [246, 35], [146, 146], [178, 146]];
  const list = (n: number) => Array.from({ length: n }, (_, i) => { const [width, height] = shapes[i % shapes.length]; return { width, height }; });

  it('each layout turns its own list in the time that makes it move at LOGO_STRIP_SPEED px per second, for any length of list: the phone (smaller logos, shorter list) is not slower than the laptop', () => {
    for (const n of [6, 8, 12, 17, 25, 40]) {
      for (const sizing of [LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SIZES.phone]) {
        const seconds = loopSeconds(list(n), sizing, LOGO_STRIP_SPEED);
        const speed = listWidth(list(n), sizing) / seconds;
        expect(Math.abs(speed - LOGO_STRIP_SPEED) / LOGO_STRIP_SPEED, `${n} logos`).toBeLessThan(0.02 + 0.5 / seconds);
      }
    }
    // and with one duration for both it would NOT be: the phone's list is shorter, so it would crawl
    const desktopSeconds = loopSeconds(list(8), LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SPEED);
    expect(listWidth(list(8), LOGO_STRIP_SIZES.phone) / desktopSeconds).toBeLessThan(LOGO_STRIP_SPEED * 0.9);
  });

  it('the speed is calm, not a crawl and not a ticker', () => {
    expect(LOGO_STRIP_SPEED).toBeGreaterThanOrEqual(20);
    expect(LOGO_STRIP_SPEED).toBeLessThanOrEqual(45);
  });

  it('a longer list takes longer to turn but moves at the same speed: 17 logos do not race past', () => {
    expect(loopSeconds(list(17), LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SPEED)).toBeGreaterThan(loopSeconds(list(8), LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SPEED));
  });

  it('never fewer than one second, whatever is asked', () => {
    expect(loopSeconds(list(6), LOGO_STRIP_SIZES.desktop, 1_000_000)).toBe(1);
  });
});

describe('the window the logos move in: as wide as the real logos allow, never wide enough to show a brand twice at once (Nuno, 31/10/2026)', () => {
  const shapes = [{ width: 405, height: 162 }, { width: 246, height: 35 }, { width: 146, height: 146 }, { width: 405, height: 80 }, { width: 404, height: 97 }, { width: 374, height: 253 }];
  const listOf = (n: number, weight?: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ ...shapes[i % shapes.length], weight: weight?.(i) }));

  /**
   * The brute-force picture of the loop: copies of the list sit exactly one list-width apart and the whole track slides left, so at any offset a logo and its copy are one list apart. Returns how many logos
   * have a PIECE of themselves in view twice at once (both copies overlap the window by more than a hair) over every offset of one full turn, in steps of a quarter of a pixel.
   */
  function logosShownTwice(logos: ReturnType<typeof listOf>, sizing: LogoSizing, windowWidth: number): number {
    const boxes = logoBoxes(logos, sizing);
    const cycle = listWidth(logos, sizing);
    let left = 0;
    const lefts = boxes.map((b) => { const x = left; left += b.width + sizing.gap; return x; });
    const twice = new Set<number>();
    for (let offset = 0; offset < cycle; offset += 0.25) {
      boxes.forEach((b, i) => {
        const first = [lefts[i] - offset, lefts[i] - offset + b.width];
        const second = [first[0] + cycle, first[1] + cycle];
        const inView = (r: number[]) => r[1] > 0.001 && r[0] < windowWidth - 0.001;
        if (inView(first) && inView(second)) twice.add(i);
      });
    }
    return twice.size;
  }

  it('is one turn of the list minus its widest logo: the first width at which any logo shows twice', () => {
    for (const n of [6, 8, 12, 17, 25]) {
      for (const sizing of [LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SIZES.phone]) {
        const logos = listOf(n);
        const widest = Math.max(...logoBoxes(logos, sizing).map((b) => b.width));
        expect(noRepeatWindow(logos, sizing), `${n} logos`).toBe(Math.floor(listWidth(logos, sizing) - widest));
      }
    }
    expect(noRepeatWindow([], LOGO_STRIP_SIZES.desktop)).toBe(0);
  });

  it('at that width no logo has two copies in view at any point of the loop, and one pixel wider the widest one does: the rule is tight, not only safe', () => {
    for (const n of [6, 8, 11, 17, 20]) {
      for (const sizing of [LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SIZES.phone]) {
        const logos = listOf(n);
        const cap = noRepeatWindow(logos, sizing);
        expect(logosShownTwice(logos, sizing, cap), `${n} logos at the cap (${cap} px)`).toBe(0);
        expect(logosShownTwice(logos, sizing, cap + 3), `${n} logos 3 px past the cap`).toBeGreaterThan(0);
      }
    }
  });

  it('holds with optical weights too (a heavier or a lighter logo changes the list, and the window follows it)', () => {
    const logos = listOf(8, (i) => [1, 1.2, 0.85, 1, 0.62, 1.1, 1, 1][i]);
    for (const sizing of [LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SIZES.phone]) {
      expect(logosShownTwice(logos, sizing, noRepeatWindow(logos, sizing))).toBe(0);
    }
    expect(noRepeatWindow(logos, LOGO_STRIP_SIZES.desktop)).not.toBe(noRepeatWindow(listOf(8), LOGO_STRIP_SIZES.desktop));
  });

  it('more logos widen the window by themselves and fewer narrow it: it is not a number to maintain', () => {
    expect(noRepeatWindow(listOf(17), LOGO_STRIP_SIZES.desktop)).toBeGreaterThan(noRepeatWindow(listOf(8), LOGO_STRIP_SIZES.desktop));
    expect(noRepeatWindow(listOf(8), LOGO_STRIP_SIZES.desktop)).toBeGreaterThan(noRepeatWindow(listOf(6), LOGO_STRIP_SIZES.desktop));
    const w = logoWindows(listOf(8), LOGO_STRIP_SIZES);
    expect(w).toEqual({ desktop: noRepeatWindow(listOf(8), LOGO_STRIP_SIZES.desktop), phone: noRepeatWindow(listOf(8), LOGO_STRIP_SIZES.phone) });
  });

  it('is always shorter than one turn of the list, so two copies of it are enough for the loop never to show an empty end, whatever the logos', () => {
    expect(LOOP_COPIES).toBe(2);
    for (const n of [1, 6, 7, 8, 10, 14, 17, 20, 40]) {
      for (const sizing of [LOGO_STRIP_SIZES.desktop, LOGO_STRIP_SIZES.phone]) {
        expect(noRepeatWindow(listOf(n), sizing), `${n} logos`).toBeLessThan(listWidth(listOf(n), sizing));
      }
    }
  });
});

describe('logoBoxes — the optical size of each logo', () => {
  const shape = (width: number, height: number) => ({ width, height });

  it('keeps the shape of every file and gives every logo the same area (when no cap is hit)', () => {
    const logos = [shape(400, 160), shape(400, 100), shape(300, 250), shape(400, 80)];
    const boxes = logoBoxes(logos, { area: 2000, maxWidth: 10_000, maxHeight: 10_000 });
    boxes.forEach((b, i) => {
      expect(b.width / b.height).toBeCloseTo(logos[i].width / logos[i].height, 1);
      expect(b.width * b.height).toBeCloseTo(2000, -1);
    });
  });

  it('a long thin wordmark is wide and LOW, a squarer mark is narrower and taller: same area, not same height', () => {
    const [wordmark, mark] = logoBoxes([shape(400, 80), shape(300, 250)], LOGO_STRIP_SIZES.desktop);
    expect(wordmark.width).toBeGreaterThan(mark.width);
    expect(wordmark.height).toBeLessThan(mark.height);
  });

  it('never goes over maxWidth or maxHeight, and keeps the shape when it is held back', () => {
    const boxes = logoBoxes([shape(800, 40), shape(100, 400), shape(300, 100)], { area: 100_000, maxWidth: 150, maxHeight: 56 });
    for (const b of boxes) {
      expect(b.width).toBeLessThanOrEqual(150);
      expect(b.height).toBeLessThanOrEqual(56);
    }
    expect(boxes[0].width / boxes[0].height).toBeCloseTo(20, 0);
    expect(boxes[1].width / boxes[1].height).toBeCloseTo(0.25, 1);
  });

  it('the phone draws every logo smaller than the laptop does, never bigger', () => {
    const logos = [shape(405, 162), shape(246, 35), shape(146, 146), shape(374, 253)];
    const d = logoBoxes(logos, LOGO_STRIP_SIZES.desktop);
    const p = logoBoxes(logos, LOGO_STRIP_SIZES.phone);
    p.forEach((b, i) => { expect(b.width).toBeLessThanOrEqual(d[i].width); expect(b.height).toBeLessThanOrEqual(d[i].height); });
  });

  it('nothing in, nothing out', () => {
    expect(logoBoxes([], LOGO_STRIP_SIZES.desktop)).toEqual([]);
  });
});
