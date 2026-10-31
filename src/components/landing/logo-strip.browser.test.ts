// Prompt 926 (30/10/2026; carousel back 31/10/2026, Nuno) — the carousel of logos in a REAL browser: the real component's markup (server-rendered) with the real landing stylesheet, next to a dark hero and the
// section that follows, so the things a unit test cannot see are measured — the carousel really MOVES, at the same speed in px per second on a laptop and on a phone, in ONE row at every width from 320 to
// 2560; the loop turns by exactly one copy of the list and never shows an empty end; the pointer stops it; "reduce motion" leaves a still row of whole logos; the title is centred right above it; the logos
// weigh the same to the eye; nothing is a band / card / circle / outline; a moderate space follows it; the compact hero keeps its spacing; and nothing makes the page wider. The real logo files are checked too:
// cropped to their own drawing, with no white disc behind them. Without a Chrome (set CHROME_PATH) it is skipped.
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

import { LANDING_LOGOS, LOGO_STRIP_SIZES, LOGO_STRIP_SPEED } from '@/content/site/logo-strip';
import { LOGO_STRIP_WINDOW, logosForPage, type LandingLogo } from '@/lib/landing-logos';
import { LogoStrip } from './LogoStrip';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

// The real logos of each page, as the page draws them (judged on a day when every authorization is already in force).
const DAY = new Date('2030-01-01T00:00:00Z');
const STARTUPS = logosForPage('startups', LANDING_LOGOS, DAY);
const INVESTORS = logosForPage('investors', LANDING_LOGOS, DAY);
const LOGO_DIR = path.join(process.cwd(), 'public', 'landing', 'logos');
const CSS = fs.readFileSync(path.join(process.cwd(), 'src/app/landing.module.css'), 'utf8');

const WIDTHS = [320, 360, 390, 600, 760, 761, 900, 1024, 1280, 1440, 1920, 2560];

type Which = 'startups' | 'investors';

describe.skipIf(!CHROME)('Logo carousel (real browser)', () => {
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  const pageHtml = (which: Which, logos: readonly LandingLogo[]) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${CSS}</style></head><body>
    <div class="landing">
      <header class="hero heroCompact" id="compact"><div class="wrap"><div><span class="badge">badge</span><h1>Title</h1><p class="lead">lead</p><div class="heroCtas">ctas</div></div><div class="mock">mock</div></div>
        <div class="strip"><div class="wrap"><span>one</span><span>two</span></div></div></header>
      ${renderToStaticMarkup(createElement(LogoStrip, { page: which, logos }))}
      <section class="sec"><div class="wrap"><h2 id="next">The next section</h2></div></section>
      <header class="hero" id="plain"><div class="wrap"><div><span class="badge">badge</span><h1>Title</h1><p class="lead">lead</p><div class="heroCtas">ctas</div></div><div class="mock">mock</div></div></header>
    </div></body></html>`;

  async function open(width: number, which: Which = 'startups', opts: { reducedMotion?: 'reduce' | 'no-preference'; height?: number } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: opts.height ?? 900 }, reducedMotion: opts.reducedMotion ?? 'no-preference' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const html = pageHtml(which, which === 'startups' ? STARTUPS : INVESTORS);
    await page.route('http://strip.test/**', (route) => {
      const url = new URL(route.request().url());
      const m = /\/landing\/logos\/([^/]+)$/.exec(url.pathname);
      if (m && fs.existsSync(path.join(LOGO_DIR, m[1]))) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(LOGO_DIR, m[1])) });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('http://strip.test/');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 });
    return { page, ctx, errors };
  }

  /** Geometry of the parts, in CSS px. */
  const measure = () => {
    const box = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top + scrollY, bottom: b.bottom + scrollY, width: b.width, height: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 + scrollY }; };
    const strip = document.querySelector('[data-logo-strip]')!;
    const track = strip.querySelector('[class="logoTrack"]')!;
    const lists = [...strip.querySelectorAll('ul')];
    const win = strip.querySelector('[class="logoWindow"]')!;
    const first = [...lists[0].querySelectorAll('img')].map((i) => ({ ...box(i), alt: i.alt, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
    const title = strip.querySelector('h2')!;
    const style = (el: Element) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, bgImage: c.backgroundImage, border: c.borderTopWidth, radius: c.borderTopLeftRadius, shadow: c.boxShadow, filter: c.filter, outline: c.outlineStyle }; };
    const pseudo = (which: '::before' | '::after') => { const c = getComputedStyle(win, which); return { bgImage: c.backgroundImage, width: c.width, pointer: c.pointerEvents, position: c.position }; };
    return {
      strip: box(strip), title: box(title), titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)), window: box(win), track: box(track),
      lists: lists.length, listBox: box(lists[0]), firstImgs: first, copies: lists.length,
      next: box(document.getElementById('next')!), hero: box(document.getElementById('compact')!),
      stripStyle: style(strip), windowStyle: style(win), trackStyle: style(track), liStyle: style(strip.querySelector('li')!), imgStyle: style(strip.querySelector('img')!),
      before: pseudo('::before'), after: pseudo('::after'),
      duration: parseFloat(getComputedStyle(track).animationDuration), playState: getComputedStyle(track).animationPlayState, animationName: getComputedStyle(track).animationName,
      transform: getComputedStyle(track).transform, overflow: getComputedStyle(win).overflowX,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hiddenLists: lists.filter((l) => getComputedStyle(l).display === 'none').length,
    };
  };

  /** The speed the track really moves at, in CSS px per second, measured over a second and a half of real time. */
  const measureSpeed = async (page: import('playwright').Page) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const v = await page.evaluate(async () => {
        const track = document.querySelector('[data-logo-strip] [class="logoTrack"]')!;
        const tx = () => new DOMMatrix(getComputedStyle(track).transform).m41;
        const a = tx(); const t0 = performance.now();
        await new Promise((r) => setTimeout(r, 1500));
        const b = tx(); const t1 = performance.now();
        return (a - b) / ((t1 - t0) / 1000);
      });
      if (v > 0) return v; // a negative one means the loop restarted in between: measure again
    }
    return 0;
  };

  it.each([[1280, 'startups'], [1920, 'startups'], [1440, 'investors'], [390, 'startups'], [320, 'investors']] as const)('%i px, %s: the carousel MOVES, continuously and smoothly, at the same speed in CSS px per second on every screen', async (w, which) => {
    const { page, ctx } = await open(w, which);
    const m = await page.evaluate(measure);
    expect(m.animationName).toBe('logoLoop');
    expect(m.playState).toBe('running');
    const speed = await measureSpeed(page);
    // the same constant speed on a 1920 px laptop and on a 320 px phone, whatever the length of the list (a few per cent for the whole-second durations and the timer)
    expect(Math.abs(speed - LOGO_STRIP_SPEED) / LOGO_STRIP_SPEED, `${w}px ${which}: ${speed.toFixed(1)} px/s`).toBeLessThan(0.08);
    // smooth: the animation is linear, so three samples a third of a second apart advance by equal steps
    const steps = await page.evaluate(async () => {
      const track = document.querySelector('[data-logo-strip] [class="logoTrack"]')!;
      const tx = () => new DOMMatrix(getComputedStyle(track).transform).m41;
      const xs: number[] = []; const ts: number[] = [];
      for (let i = 0; i < 4; i++) { xs.push(tx()); ts.push(performance.now()); await new Promise((r) => setTimeout(r, 350)); }
      return xs.slice(1).map((x, i) => (xs[i] - x) / ((ts[i + 1] - ts[i]) / 1000));
    });
    for (const s of steps) expect(Math.abs(s - LOGO_STRIP_SPEED) / LOGO_STRIP_SPEED).toBeLessThan(0.15);
    await ctx.close();
  }, 60_000);

  it('the phone and the laptop each turn their own list in the time that makes the same speed: the durations differ, the px per second do not', async () => {
    const a = await open(1440);
    const b = await open(390);
    const ma = await a.page.evaluate(measure);
    const mb = await b.page.evaluate(measure);
    expect(ma.duration).not.toBe(mb.duration);
    expect(ma.listBox.width / ma.duration).toBeCloseTo(LOGO_STRIP_SPEED, -1);
    expect(mb.listBox.width / mb.duration).toBeCloseTo(LOGO_STRIP_SPEED, -1);
    expect(Math.abs(ma.listBox.width / ma.duration - mb.listBox.width / mb.duration)).toBeLessThan(2.5);
    await a.ctx.close(); await b.ctx.close();
  }, 60_000);

  it.each(['startups', 'investors'] as const)('%s: the loop turns by EXACTLY one copy of the list and never shows an empty end, at every width up to 2560 px; the start and the end of a turn are the same picture (no jump)', async (which) => {
    for (const w of [320, 390, 760, 1280, 1920, 2560]) {
      const { page, ctx } = await open(w, which);
      const r = await page.evaluate(() => {
        const strip = document.querySelector('[data-logo-strip]')!;
        const track = strip.querySelector('[class="logoTrack"]') as HTMLElement;
        const win = strip.querySelector('[class="logoWindow"]')!.getBoundingClientRect();
        const list = strip.querySelector('ul')!.getBoundingClientRect().width;
        const anim = track.getAnimations()[0];
        anim.pause();
        const duration = Number(anim.effect!.getTiming().duration);
        const at = (f: number) => { anim.currentTime = duration * f; return { tx: new DOMMatrix(getComputedStyle(track).transform).m41, right: track.getBoundingClientRect().right, left: track.getBoundingClientRect().left }; };
        const start = at(0); const nearEnd = at(0.9999); const mid = at(0.5);
        // at the furthest the track gets, its right end must still reach the right end of the window; at the start its left end must be at or before the left end of the window
        const worstRight = Math.min(...[0, 0.25, 0.5, 0.75, 0.9999].map((f) => at(f).right));
        return { list, tx0: start.tx, txEnd: nearEnd.tx, txMid: mid.tx, worstRight, winRight: win.right, startLeft: start.left, winLeft: win.left, copies: strip.querySelectorAll('ul').length };
      });
      expect(r.tx0, `${which} ${w}`).toBe(0);
      expect(Math.abs(r.txEnd + r.list), `${which} ${w}: a turn is one list`).toBeLessThan(1);
      expect(Math.abs(r.txMid + r.list / 2), `${which} ${w}: linear`).toBeLessThan(1);
      expect(r.worstRight, `${which} ${w}: no empty end`).toBeGreaterThanOrEqual(r.winRight - 0.5);
      expect(r.startLeft).toBeLessThanOrEqual(r.winLeft + 0.5);
      expect(r.copies).toBeGreaterThanOrEqual(2);
      await ctx.close();
    }
  }, 240_000);

  it.each(WIDTHS)('%i px: ONE row at every width — no grid, no second line: every logo of the list is on the same line, in a track as tall as one logo', async (w) => {
    const { page, ctx } = await open(w, 'investors');
    const m = await page.evaluate(measure);
    const cys = m.firstImgs.map((i) => i.cy);
    expect(Math.max(...cys) - Math.min(...cys)).toBeLessThanOrEqual(1);
    expect(m.firstImgs).toHaveLength(INVESTORS.length);
    expect(m.listBox.height).toBeLessThanOrEqual(Math.max(...m.firstImgs.map((i) => i.h)) + 1);
    // in a row of logos side by side, in the order of the file, none over another
    const sorted = [...m.firstImgs].sort((a, b) => a.left - b.left);
    expect(sorted.map((i) => i.alt)).toEqual(INVESTORS.map((l) => l.name));
    sorted.slice(1).forEach((im, i) => expect(im.left, `${im.alt} ${w}`).toBeGreaterThanOrEqual(sorted[i].right - 0.5));
    expect(m.pageOverflow, `${w}`).toBe(0);
    await ctx.close();
  }, 60_000);

  it('the logos enter and leave at the ends of the window: at some moment of a turn a logo is cut by the edge (and it is faded there), at no moment is the window empty', async () => {
    const { page, ctx } = await open(1440);
    const r = await page.evaluate(() => {
      const strip = document.querySelector('[data-logo-strip]')!;
      const track = strip.querySelector('[class="logoTrack"]')!;
      const win = strip.querySelector('[class="logoWindow"]')!.getBoundingClientRect();
      const anim = track.getAnimations()[0]; anim.pause();
      const duration = Number(anim.effect!.getTiming().duration);
      let cutLeft = 0; let cutRight = 0; let emptyMoments = 0;
      for (let f = 0; f < 1; f += 0.01) {
        anim.currentTime = duration * f;
        const imgs = [...strip.querySelectorAll('img')].map((i) => i.getBoundingClientRect());
        if (imgs.some((b) => b.left < win.left && b.right > win.left + 4)) cutLeft++;
        if (imgs.some((b) => b.left < win.right - 4 && b.right > win.right)) cutRight++;
        if (!imgs.some((b) => b.right > win.left && b.left < win.right)) emptyMoments++;
      }
      return { cutLeft, cutRight, emptyMoments };
    });
    expect(r.cutLeft).toBeGreaterThan(0);
    expect(r.cutRight).toBeGreaterThan(0);
    expect(r.emptyMoments).toBe(0);
    const m = await page.evaluate(measure);
    expect(m.windowStyle.bg).toBe('rgba(0, 0, 0, 0)');
    expect(m.overflow).toBe('hidden');
    for (const side of [m.before, m.after]) {
      expect(side.bgImage).toContain('linear-gradient');
      expect(side.pointer).toBe('none');
      expect(side.width).toBe('72px');
    }
    // the fade is the PAGE's colour (#f7fafa) at its outer edge, not white
    expect(m.before.bgImage).toMatch(/rgb\(247, 250, 250\)/);
    await ctx.close();
  }, 60_000);

  it('the window is the whole width of the page up to 1600 px, then centred: the logos run edge to edge on a laptop and a phone', async () => {
    for (const [w, expected] of [[390, 390], [1280, 1280], [1440, 1440], [1920, LOGO_STRIP_WINDOW], [2560, LOGO_STRIP_WINDOW]] as const) {
      const { page, ctx } = await open(w);
      const m = await page.evaluate(measure);
      expect(m.window.width, `${w}`).toBe(expected);
      expect(Math.abs(m.window.cx - w / 2), `${w}`).toBeLessThanOrEqual(1);
      await ctx.close();
    }
  }, 60_000);

  it('the pointer on the carousel stops it, and taking it away starts it again', async () => {
    const { page, ctx } = await open(1440);
    const read = () => page.evaluate(() => ({ x: new DOMMatrix(getComputedStyle(document.querySelector('[data-logo-strip] [class="logoTrack"]')!).transform).m41, state: getComputedStyle(document.querySelector('[data-logo-strip] [class="logoTrack"]')!).animationPlayState }));
    await page.evaluate(() => document.querySelector('[data-logo-strip]')!.scrollIntoView());
    const box = (await page.locator('[data-logo-strip] [class="logoWindow"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const a = await read();
    await page.waitForTimeout(900);
    const b = await read();
    expect(a.state).toBe('paused');
    expect(b.x).toBe(a.x);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const c = await read();
    await page.waitForTimeout(700);
    const d = await read();
    expect(d.state).toBe('running');
    expect(d.x).toBeLessThan(c.x);
    await ctx.close();
  }, 60_000);

  it('"reduce motion": nothing moves, the copies are gone, and what is left is ONE still row of whole logos, none cut by an edge, centred, with nothing making the page wider', async () => {
    for (const [w, which] of [[1440, 'startups'], [390, 'startups'], [320, 'investors'], [1920, 'investors']] as const) {
      const { page, ctx } = await open(w, which, { reducedMotion: 'reduce' });
      const m = await page.evaluate(measure);
      expect(m.animationName, `${which} ${w}`).toBe('none');
      expect(m.transform, `${which} ${w}`).toBe('none');
      expect(m.hiddenLists, `${which} ${w}`).toBe(m.lists - 1);
      const shown = m.firstImgs.filter((i) => i.top < m.listBox.top + m.listBox.height + 1 && i.bottom > m.listBox.top - 1);
      expect(shown.length, `${which} ${w}`).toBeGreaterThan(0);
      const cys = shown.map((i) => i.cy);
      expect(Math.max(...cys) - Math.min(...cys), `${which} ${w}`).toBeLessThanOrEqual(1);
      for (const im of shown) {
        expect(im.left, `${im.alt} ${w}`).toBeGreaterThanOrEqual(m.window.left - 0.5);
        expect(im.right, `${im.alt} ${w}`).toBeLessThanOrEqual(m.window.right + 0.5);
      }
      expect(Math.abs((Math.min(...shown.map((i) => i.left)) - m.window.left) - (m.window.right - Math.max(...shown.map((i) => i.right)))), `${which} ${w}: centred`).toBeLessThanOrEqual(LOGO_STRIP_SIZES.desktop.gap);
      expect(m.pageOverflow, `${which} ${w}`).toBe(0);
      await ctx.close();
    }
  }, 120_000);

  it.each([1280, 1440, 1920, 390])('%i px: the title is one centred line (two at most on a phone) right above the carousel, in the same area; the logos weigh the same to the eye and keep their own shape', async (w) => {
    const { page, ctx } = await open(w);
    const m = await page.evaluate(measure);
    expect(m.titleLines).toBeLessThanOrEqual(w >= 700 ? 1 : 2);
    expect(Math.abs(m.title.cx - w / 2)).toBeLessThanOrEqual(1);
    expect(m.title.bottom).toBeLessThan(m.window.top + 1);
    expect(m.window.top - m.title.bottom).toBeLessThanOrEqual(24);
    // the title is outside the track: it does not move with it
    expect(m.title.top).toBeLessThan(m.window.top);
    const sizing = w <= 760 ? LOGO_STRIP_SIZES.phone : LOGO_STRIP_SIZES.desktop;
    const areas = m.firstImgs.map((i) => i.w * i.h);
    for (const a of areas) expect(a).toBeLessThanOrEqual(sizing.area * 1.03);
    expect(areas.filter((a) => a >= sizing.area * 0.97).length).toBeGreaterThanOrEqual(Math.ceil(areas.length * 0.6));
    STARTUPS.forEach((l, i) => expect(m.firstImgs[i].w / m.firstImgs[i].h, l.name).toBeCloseTo(l.width / l.height, 1));
    for (const im of m.firstImgs) { expect(im.w).toBeLessThanOrEqual(sizing.maxWidth + 0.5); expect(im.h).toBeLessThanOrEqual(sizing.maxHeight + 0.5); }
    await ctx.close();
  }, 60_000);

  it('no band, no card, no circle, no outline, no shadow, no filter: the section, the window, the items and the images are plain, on the page\'s own colour', async () => {
    const { page, ctx } = await open(1440);
    const m = await page.evaluate(measure);
    for (const s of [m.stripStyle, m.windowStyle, m.liStyle, m.imgStyle]) {
      expect(s.bg).toBe('rgba(0, 0, 0, 0)');
      expect(s.bgImage).toBe('none');
      expect(s.border).toBe('0px');
      expect(s.radius).toBe('0px');
      expect(s.shadow).toBe('none');
      expect(s.filter).toBe('none');
      expect(s.outline).toBe('none');
    }
    await ctx.close();
  }, 60_000);

  it('what follows the carousel starts with a moderate space, not the 96 px of a section on its own: 55 to 90 px from the logos to the next heading on a laptop, 45 to 90 on a phone', async () => {
    for (const [w, lo, hi] of [[1440, 55, 90], [390, 45, 90]] as const) {
      const { page, ctx } = await open(w);
      const m = await page.evaluate(measure);
      const lastBottom = Math.max(...m.firstImgs.map((i) => i.bottom));
      const gap = m.next.top - lastBottom;
      expect(gap, `${w}px`).toBeGreaterThanOrEqual(lo);
      expect(gap, `${w}px`).toBeLessThanOrEqual(hi);
      await ctx.close();
    }
  }, 60_000);

  it('the whole strip is one logo row tall: well under 200 px on a laptop and on a phone, never the hundreds of pixels of a grid', async () => {
    for (const [w, max] of [[1440, 190], [390, 170]] as const) {
      const { page, ctx } = await open(w, 'investors');
      const m = await page.evaluate(measure);
      expect(m.strip.height, `${w}px`).toBeLessThanOrEqual(max + (m.titleLines - 1) * 30);
      await ctx.close();
    }
  }, 60_000);

  it('the hero of the two landing pages keeps the compact spacing and no height of its own; a plain hero (any other page) keeps 170 / 110 — the modifier only moves vertical space', async () => {
    const { page, ctx } = await open(1440);
    const read = () => page.evaluate(() => {
      const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        compact: { top: css('#compact').paddingTop, bottom: css('#compact > .wrap').paddingBottom, badge: css('#compact .badge').marginBottom, h1: css('#compact h1').marginBottom, lead: css('#compact .lead').marginBottom, ctas: css('#compact .heroCtas').marginBottom, gap: css('#compact > .wrap').rowGap, minH: css('#compact').minHeight, h1Size: css('#compact h1').fontSize, bar: css('#compact .strip .wrap').padding },
        plain: { top: css('#plain').paddingTop, bottom: css('#plain > .wrap').paddingBottom, badge: css('#plain .badge').marginBottom, h1: css('#plain h1').marginBottom, lead: css('#plain .lead').marginBottom, ctas: css('#plain .heroCtas').marginBottom, h1Size: css('#plain h1').fontSize },
      };
    });
    const wide = await read();
    expect(wide.compact).toMatchObject({ top: '96px', bottom: '28px', badge: '14px', h1: '12px', lead: '20px', ctas: '16px', minH: '0px', bar: '18px 24px' });
    expect(wide.plain).toMatchObject({ top: '170px', bottom: '110px', badge: '22px', h1: '20px', lead: '32px', ctas: '28px' });
    // no text is made smaller to make the hero shorter
    expect(wide.compact.h1Size).toBe(wide.plain.h1Size);
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await read();
    expect(phone.compact).toMatchObject({ top: '96px', bottom: '48px', gap: '28px', bar: '18px 24px' }); // the bar of checks keeps its own 18 px (it used to get the hero's 80)
    expect(phone.plain).toMatchObject({ top: '170px', bottom: '80px' });
    await ctx.close();
  }, 60_000);

  it('the compact hero ends where the carousel begins, with only the section\'s own 40 px (32 on a phone) of air above the title', async () => {
    for (const [w, pad] of [[1440, 40], [390, 32]] as const) {
      const { page, ctx } = await open(w);
      const m = await page.evaluate(measure);
      expect(m.strip.top).toBeCloseTo(m.hero.bottom, 0);
      expect(m.title.top - m.strip.top).toBeCloseTo(pad, 0);
      await ctx.close();
    }
  }, 60_000);

  it('at every width from 320 to 2560 px nothing makes the page wider and nothing is broken', async () => {
    for (const which of ['startups', 'investors'] as const) {
      for (const w of WIDTHS) {
        const { page, ctx, errors } = await open(w, which);
        const m = await page.evaluate(measure);
        expect(m.pageOverflow, `${which} ${w}`).toBe(0);
        expect(m.firstImgs.length).toBe((which === 'startups' ? STARTUPS : INVESTORS).length);
        expect(errors).toEqual([]);
        await ctx.close();
      }
    }
  }, 240_000);

  it('the real logo files are cropped to their own drawing and have no white disc, no card and no margin behind them (Nuno, 31/10/2026: no circles or outlines)', async () => {
    const { page, ctx } = await open(1280);
    const files = [...STARTUPS, ...INVESTORS].map((l) => l.file);
    const res = await page.evaluate(async (list) => {
      const out: Record<string, { whiteFill: number; margin: number }> = {};
      for (const f of list) {
        const img = new Image();
        img.src = `/landing/logos/${f}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
        let white = 0; let minX = width; let maxX = 0; let minY = height; let maxY = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3] > 200 && data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
          if (data[i + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
        out[f] = { whiteFill: white / (width * height), margin: Math.max(minX, minY, width - 1 - maxX, height - 1 - maxY) };
      }
      return out;
    }, files);
    for (const f of files) {
      // not a disc: opaque white is no part of the picture, and the drawing runs to (within 6 px of) the edges of its file
      expect(res[f].whiteFill, `${f}: a white disc or fill`).toBeLessThan(0.05);
      expect(res[f].margin, `${f}: not cropped to its drawing`).toBeLessThanOrEqual(6);
    }
    await ctx.close();
  }, 120_000);
});
