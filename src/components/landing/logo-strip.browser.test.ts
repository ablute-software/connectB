// Prompt 926 (30/10/2026) — the strip of logos in a REAL browser: the real component's markup (server-rendered) with the real landing stylesheet, so the things a unit test
// cannot see are measured — the loop turns by exactly one copy of the list and never shows an empty end, the pointer stops it, "reduce motion" leaves a still row of whole
// logos, a long logo is held to its box, the label is beside the logos on a laptop and above them on a phone, and nothing makes the page wider. Without a Chrome
// (set CHROME_PATH) it is skipped. The logos are invented (zz-test-*) and drawn as plain rectangles of the right shape.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The stylesheet is a CSS module; here its class names are their own names, so the raw file can be handed to the browser as it is.
vi.mock('@/app/landing.module.css', () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }));

// The React that vitest renders with (18.3.1) does not know `fetchPriority` yet — the one inside Next does — and says so on the console for every render.
const realError = console.error;
console.error = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].includes('fetchPriority')) return; realError(...args); };

import { LOGO_STRIP_LOOP_SECONDS, LOGO_STRIP_SIZES } from '@/content/site/logo-strip';
import type { LandingLogo } from '@/lib/landing-logos';
import { LogoStrip } from './LogoStrip';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

const SHAPES: Array<[number, number]> = [[512, 512], [512, 512], [512, 512], [200, 40], [512, 512], [100, 50], [512, 512], [200, 40], [60, 60], [512, 512]];
const LOGOS: LandingLogo[] = SHAPES.map(([width, height], i) => ({
  name: `zz-test-${i + 1}`, file: `zz-test-${i + 1}.svg`, width, height, pages: 'both', order: i + 1, authorization: { date: '2026-10-29', form: 'email' },
}));
const CSS = fs.readFileSync(path.join(process.cwd(), 'src/app/landing.module.css'), 'utf8');

describe.skipIf(!CHROME)('Logo strip (real browser)', () => {
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  const markup = renderToStaticMarkup(createElement(LogoStrip, { page: 'startups', logos: LOGOS }));
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${CSS}</style></head><body><div class="landing">${markup}</div></body></html>`;

  async function open(width: number, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, reducedMotion: opts.reducedMotion ?? 'no-preference' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://strip.test/**', (route) => {
      const url = new URL(route.request().url());
      const m = /\/zz-test-(\d+)\.svg$/.exec(url.pathname);
      if (m) {
        const [w, h] = SHAPES[Number(m[1]) - 1];
        return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#1f5aa6"/></svg>` });
      }
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('http://strip.test/');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    return { page, ctx, errors };
  }

  /** Geometry of the parts, in CSS px. */
  const measure = () => {
    const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const strip = document.querySelector('[data-logo-strip]')!;
    const lists = [...strip.querySelectorAll('ul')];
    const track = strip.querySelector('[class="logoTrack"]')!;
    return {
      strip: r(strip), label: r(strip.querySelector('.logoLabel')), window: r(strip.querySelector('.logoWindow')), track: r(track), firstList: r(lists[0]),
      lists: lists.length, imgs: [...lists[0].querySelectorAll('img')].map(r),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  };

  it('1280 px: the loop turns by exactly one copy of the list in one turn, and the track is long enough that no end is ever empty', async () => {
    const { page, ctx, errors } = await open(1280);
    const t = await page.evaluate(() => {
      const track = document.querySelector('[data-logo-strip] .logoTrack') as HTMLElement;
      const animations = track.getAnimations();
      const a = animations[0];
      const timing = a.effect!.getTiming();
      const tx = () => new DOMMatrix(getComputedStyle(track).transform).m41;
      a.pause();
      a.currentTime = 0;
      const start = tx();
      a.currentTime = (timing.duration as number) - 0.01; // the last instant of a turn
      const end = tx();
      const list = track.querySelector('ul')!.getBoundingClientRect().width;
      const win = (track.parentElement as HTMLElement).getBoundingClientRect().width;
      return { count: animations.length, duration: timing.duration, iterations: timing.iterations, easing: timing.easing, name: (a as CSSAnimation).animationName, start, end, list, track: track.getBoundingClientRect().width, win };
    });
    expect(t.count).toBe(1);
    expect(t.name).toBe('logoLoop');
    expect(t.duration).toBe(LOGO_STRIP_LOOP_SECONDS * 1000);
    expect(t.iterations).toBe(Infinity);
    expect(t.easing).toBe('linear');
    expect(t.start).toBe(0);
    // at the end of a turn the track has moved by one whole copy: the next turn starts from a picture identical to this one, so there is no jump
    expect(Math.abs(t.end + t.list)).toBeLessThan(0.5);
    // the copies after the first one fill the window at every moment of the turn
    expect(t.track - t.list).toBeGreaterThanOrEqual(t.win);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('375 px (phone): same promise with the phone sizes — the track still reaches past the window at the end of the turn', async () => {
    const { page, ctx } = await open(375);
    const t = await page.evaluate(() => {
      const track = document.querySelector('[data-logo-strip] .logoTrack') as HTMLElement;
      return { list: track.querySelector('ul')!.getBoundingClientRect().width, track: track.getBoundingClientRect().width, win: (track.parentElement as HTMLElement).getBoundingClientRect().width };
    });
    expect(t.track - t.list).toBeGreaterThanOrEqual(t.win);
    await ctx.close();
  });

  it('the pointer over the strip stops it where it is; taking the pointer away lets it go on', async () => {
    const { page, ctx } = await open(1280);
    const m = await page.evaluate(measure);
    const state = () => page.evaluate(() => {
      const track = document.querySelector('[data-logo-strip] .logoTrack') as HTMLElement;
      return { play: getComputedStyle(track).animationPlayState, time: track.getAnimations()[0].currentTime as number };
    });
    await page.waitForTimeout(250);
    expect((await state()).play).toBe('running');
    await page.mouse.move(m.window.left + m.window.width / 2, m.window.top + m.window.height / 2);
    await page.waitForTimeout(150);
    const held = await state();
    expect(held.play).toBe('paused');
    await page.waitForTimeout(500);
    expect((await state()).time).toBe(held.time);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const after = await state();
    expect(after.play).toBe('running');
    expect(after.time).toBeGreaterThan(held.time);
    await ctx.close();
  });

  it('"reduce motion": nothing moves, the copies made for the seam are not drawn, and what is shown is a single row of whole logos (the rest wrapped out of sight)', async () => {
    const { page, ctx } = await open(1280, { reducedMotion: 'reduce' });
    const t = await page.evaluate(() => {
      const strip = document.querySelector('[data-logo-strip]')!;
      const track = strip.querySelector('.logoTrack') as HTMLElement;
      const win = (strip.querySelector('.logoWindow') as HTMLElement).getBoundingClientRect();
      const lists = [...strip.querySelectorAll('ul')];
      const first = lists[0];
      const firstBox = first.getBoundingClientRect();
      const items = [...first.querySelectorAll('li')].map((li) => li.getBoundingClientRect());
      const visible = items.filter((b) => b.top < firstBox.bottom - 0.5);
      return {
        animations: track.getAnimations().length, transform: getComputedStyle(track).transform,
        copiesShown: lists.slice(1).filter((l) => getComputedStyle(l).display !== 'none').length,
        total: items.length, visible: visible.length,
        cut: visible.filter((b) => b.left < win.left - 0.5 || b.right > win.right + 0.5).length,
        rows: new Set(visible.map((b) => Math.round(b.top))).size,
      };
    });
    expect(t.animations).toBe(0);
    expect(t.transform).toBe('none');
    expect(t.copiesShown).toBe(0);
    expect(t.total).toBe(LOGOS.length);
    expect(t.visible).toBeGreaterThan(0);
    expect(t.visible).toBeLessThan(t.total); // not everything fits in one row at this width: the rest are not shown
    expect(t.rows).toBe(1);
    expect(t.cut).toBe(0);
    await ctx.close();
  });

  it('1280 px: the label is beside the logos, the band is as tall as one logo plus its padding, and the page is no wider than the screen', async () => {
    const { page, ctx } = await open(1280);
    const m = await page.evaluate(measure);
    expect(m.label.right).toBeLessThanOrEqual(m.window.left);
    expect(Math.abs((m.label.top + m.label.bottom) / 2 - (m.window.top + m.window.bottom) / 2)).toBeLessThan(1);
    expect(m.strip.height).toBeCloseTo(LOGO_STRIP_SIZES.height + 24, 0);
    expect(m.strip.width).toBe(1280);
    expect(m.lists).toBeGreaterThanOrEqual(2);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  it('375 px: the label is above the logos, and again the page is no wider than the screen', async () => {
    const { page, ctx } = await open(375);
    const m = await page.evaluate(measure);
    expect(m.label.bottom).toBeLessThanOrEqual(m.window.top);
    expect(m.window.width).toBe(375);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  it('every logo is drawn in a box of the same height; a long one is held to the largest width instead of growing (desktop and phone)', async () => {
    for (const [width, h, maxW] of [[1280, LOGO_STRIP_SIZES.height, LOGO_STRIP_SIZES.maxWidth], [375, LOGO_STRIP_SIZES.heightPhone, LOGO_STRIP_SIZES.maxWidthPhone]] as const) {
      const { page, ctx } = await open(width);
      const m = await page.evaluate(measure);
      expect(m.imgs).toHaveLength(LOGOS.length);
      for (const [i, b] of m.imgs.entries()) {
        expect(b.height, `logo ${i + 1} at ${width}px`).toBeCloseTo(h, 1);
        expect(b.width, `logo ${i + 1} at ${width}px`).toBeLessThanOrEqual(maxW + 0.05);
      }
      // the square ones are as wide as they are tall; the 5:1 ones would be 5 times that and are held to the largest width
      expect(m.imgs[0].width).toBeCloseTo(h, 1);
      expect(m.imgs[3].width).toBeCloseTo(maxW, 1);
      await ctx.close();
    }
  });

  it('both ends fade to white and the fade is not in the way of the pointer', async () => {
    const { page, ctx } = await open(1280);
    const f = await page.evaluate(() => {
      const w = document.querySelector('[data-logo-strip] .logoWindow') as HTMLElement;
      const before = getComputedStyle(w, '::before');
      const after = getComputedStyle(w, '::after');
      return { b: before.backgroundImage, a: after.backgroundImage, pb: before.pointerEvents, pa: after.pointerEvents, bw: before.width, aw: after.width };
    });
    expect(f.b).toContain('linear-gradient');
    expect(f.a).toContain('linear-gradient');
    expect(f.pb).toBe('none');
    expect(f.pa).toBe('none');
    expect(f.bw).toBe('64px');
    expect(f.aw).toBe('64px');
    await ctx.close();
  });
});
