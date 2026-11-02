// Prompt 926 (30/10/2026; carousel back and logos out of the hero 31/10/2026, Nuno) — where the carousel of logos sits on the two landing pages, the compact hero they keep, and the stylesheet's promises
// (a carousel and never a grid, transform-only motion at a constant speed, still on hover and under "reduce motion", edges that fade into the page, no band / card / circle / outline, a moderate space
// after it). Pinned at the source, like landing-contrast.test.ts, because none of it is visible to a unit test's natural field of view: it is a selector's specificity, an order of tags, a property that is
// or is not in a rule. The measured side of the same promises — the carousel really moving at the same speed on a laptop and on a phone, the edges, the pause, the hero's height — is in
// logo-strip.browser.test.ts and in docs/screenshots-landing-carousel-20261031/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGO_STRIP_FADE } from '@/content/site/logo-strip';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

interface Rule { selector: string; body: string; media: string | null }
/** The rules of a stylesheet, with the @media / @supports they sit in; comments gone. @keyframes come back as one rule whose selector is the whole @keyframes line. */
function parseCss(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (s: string, media: string | null) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const inner = s.slice(open + 1, j - 1);
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(inner, head);
      else out.push({ selector: head, body: inner.trim(), media });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}
const declarations = (body: string) => Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }));
const css = parseCss(read('src/app/landing.module.css'));
const find = (selector: string, media: string | null = null) => css.filter((r) => r.selector === selector && r.media === media);
const decl = (selector: string, media: string | null = null) => declarations(find(selector, media)[0].body);
const px = (v: string) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v)?.[1]);

// Prompt 935 (02/11/2026) — 'where the carousel sits' and the old hero's spacing was pinned to the previous landing's source (the two pages are now the fixed one-screen landing, src/components/landing-fixed/); the equivalent promises are pinned in src/lib/landing-fixed.test.ts.

describe('the carousel\'s stylesheet', () => {
  const rules = css.filter((r) => /\.logo[A-Z]/.test(r.selector) && !r.selector.startsWith('@keyframes'));

  it('every rule is under .logoStrip (".landing *" resets margin and padding at (0,1,0): a lone class would only tie with it and win or lose by the order of the files)', () => {
    expect(rules.length).toBeGreaterThan(10);
    for (const r of rules) for (const part of r.selector.split(',')) expect(part.trim().startsWith('.logoStrip'), part).toBe(true);
  });

  it('a carousel and NEVER a grid or a list: no grid, no wrapping, no columns at any width — the one wrapping is the still picture of "reduce motion", which shows one row', () => {
    for (const r of rules) {
      const d = declarations(r.body);
      expect(Object.keys(d).filter((k) => /^grid|^column-count|^columns$/.test(k)), r.selector).toEqual([]);
      expect(d.display, r.selector).not.toBe('grid');
      if (d['flex-wrap'] === 'wrap') expect(r.media, r.selector).toBe('@media (prefers-reduced-motion: reduce)');
    }
    expect(read('src/app/landing.module.css')).not.toMatch(/logoBreak|logoFrame|logo-cols|container-type/);
  });

  it('the motion is transform only: the keyframes touch nothing else, so nothing can move with it', () => {
    const k = css.find((r) => r.selector === '@keyframes logoLoop');
    expect(k).toBeDefined();
    const props = new Set([...k!.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    expect([...props]).toEqual(['transform']);
    expect(k!.body).toContain('translateX(0)');
    expect(k!.body).toContain('translateX(calc(-100% / var(--logo-copies)))'); // exactly one copy of the list: no jump at the end of the turn
  });

  it('the track turns at a constant speed (linear), continuously and forever, from the time of the layout, on its own layer; the phone uses ITS time, so the speed in px per second is the same', () => {
    const track = decl('.logoStrip .logoTrack');
    expect(track.animation).toBe('logoLoop var(--logo-loop) linear infinite');
    expect(track['will-change']).toBe('transform');
    expect(track.width).toBe('max-content');
    expect(track.display).toBe('flex');
    expect(decl('.logoStrip .logoTrack', '@media (max-width: 760px)')['animation-duration']).toBe('var(--logo-loop-phone)');
  });

  it('it stops while the pointer is over it or a finger is on it', () => {
    expect(declarations(find('.logoStrip .logoWindow:hover .logoTrack, .logoStrip .logoWindow:active .logoTrack')[0].body)['animation-play-state']).toBe('paused');
  });

  it('under "reduce motion" it stands still, in one row of whole logos (the rest pushed out of sight), without the copies that only exist for the seam', () => {
    const media = '@media (prefers-reduced-motion: reduce)';
    const track = decl('.logoStrip .logoTrack', media);
    expect(track.animation).toBe('none');
    const list = decl('.logoStrip .logoList', media);
    expect(list['flex-wrap']).toBe('wrap');
    expect(list.overflow).toBe('hidden');
    expect(list.height).toBe('var(--maxh)');
    expect(px(list['row-gap'])).toBeGreaterThan(100);
    expect(decl(".logoStrip .logoList[aria-hidden='true']", media).display).toBe('none');
  });

  it('both ends fade into the PAGE\'s own colour (--bg, not white: the area is not a band), and the fade never catches a click or a hover; the logos enter and leave at the edges', () => {
    const before = decl('.logoStrip .logoWindow::before');
    const after = decl('.logoStrip .logoWindow::after');
    expect(before.background).toBe('linear-gradient(to right, var(--bg), rgba(247, 250, 250, 0))');
    expect(after.background).toBe('linear-gradient(to left, var(--bg), rgba(247, 250, 250, 0))');
    expect(declarations(find('.logoStrip .logoWindow::before, .logoStrip .logoWindow::after')[0].body)['pointer-events']).toBe('none');
    expect(decl('.logoStrip .logoWindow').overflow).toBe('hidden');
    // the rgba in the gradients IS the page colour
    expect(read('src/app/landing.module.css')).toMatch(/--bg:\s*#f7fafa/i);
  });

  it('no band, no card, no circle, no outline, no shadow, no filter: the only background anywhere in the logos\' rules is the fade at the two ends', () => {
    const forbidden = /^(background(-.*)?|border(-(top|right|bottom|left|radius|color|width|style))?|border-radius|box-shadow|outline.*|opacity|filter|backdrop-filter|mix-blend-mode|mask.*|clip-path)$/;
    for (const r of css.filter((x) => x.selector.startsWith('.logoStrip'))) {
      const bad = Object.keys(declarations(r.body)).filter((k) => forbidden.test(k));
      const allowed = r.selector === '.logoStrip .logoWindow::before' || r.selector === '.logoStrip .logoWindow::after' ? ['background']
        : r.selector === '.logoStrip + .claimSec' ? ['border-top'] : []; // the claim section's own top line is REMOVED while the carousel sits right above it
      expect(bad.filter((k) => !allowed.includes(k)), r.selector).toEqual([]);
    }
    expect(decl('.logoStrip')).toEqual({ '--gap': 'var(--logo-gap)', '--maxh': 'var(--logo-maxh)', '--win': 'var(--logo-window)', '--fade': 'var(--logo-fade)', padding: '44px 0 0' });
    const img = decl('.logoStrip .logoImg');
    expect(img.width).toBe('calc(var(--w) * 1px)');
    expect(img.height).toBe('auto');
    expect(decl('.logoStrip .logoImg', '@media (max-width: 760px)').width).toBe('calc(var(--wp) * 1px)');
    expect(read('src/app/landing.module.css')).not.toMatch(/\.logoInner|\.logoHead|\.logoLabel/);
  });

  it('what follows the carousel starts with room to breathe but far less than the 96 px a section normally begins with (60 px, 44 px on a phone), and the claim section loses its top line there; the strip itself has 44 px above its title (32 on a phone) — Nuno, 31/10/2026: "deixa respirar um pouco mais" (they were 28 / 34 px, and 40 / 46 before the 4th round)', () => {
    expect(decl('.sec').padding).toBe('96px 0');
    expect(decl('.logoStrip + .sec')).toEqual({ 'padding-top': '60px' });
    expect(decl('.logoStrip + .sec', '@media (max-width: 760px)')).toEqual({ 'padding-top': '44px' });
    expect(px(decl('.logoStrip', '@media (max-width: 760px)')['padding-top'])).toBe(32);
    expect(declarations(find('.logoStrip + .claimSec')[0].body)['border-top']).toBe('0');
  });

  it('the title is a DISCREET centred line — 17 px (1.0625rem; Nuno asked for about 16-18 px) — of the page\'s own heading font and ink, much smaller than a section heading, right above the carousel; ink on --bg passes WCAG AAA', () => {
    const t = decl('.logoStrip .logoTitle');
    expect(t['text-align']).toBe('center');
    expect(t['font-size']).toBe('1.0625rem');
    expect(parseFloat(t['font-size']) * 16).toBeGreaterThanOrEqual(16);
    expect(parseFloat(t['font-size']) * 16).toBeLessThanOrEqual(18);
    expect(t['margin-bottom']).toBe('4px');
    expect(Object.keys(t)).not.toContain('color'); // the ink it gets from ".landing h2"
    expect(Object.keys(t)).not.toContain('font-family');
    expect(decl('.secHead h2')['font-size']).toBe('clamp(1.8rem, 3.4vw, 2.5rem)');
    const tokens = Object.fromEntries([...read('src/app/landing.module.css').matchAll(/--(ink|bg):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    expect(ratio(tokens.ink, tokens.bg)).toBeGreaterThanOrEqual(7);
  });

  it('the window is as wide as the real logos allow and no wider, centred, and everything past it is cut off: its width and the fade come from custom properties that LogoStrip works out from the logos, never a number written in the stylesheet', () => {
    const win = decl('.logoStrip .logoWindow');
    expect(win['max-width']).toBe('var(--win)');
    expect(win.margin).toBe('0 auto');
    expect(win.overflow).toBe('hidden');
    expect(decl('.logoStrip .logoWindow::before, .logoStrip .logoWindow::after').width).toBe('var(--fade)');
    // no fixed window width (the old 1600 px) and no fixed fade anywhere in the logo rules
    for (const r of css.filter((x) => x.selector.startsWith('.logoStrip'))) expect(r.body, r.selector).not.toMatch(/(max-)?width\s*:\s*\d{3,}px|width\s*:\s*\d+px/);
    expect(read('src/components/landing/LogoStrip.tsx')).toContain("'--logo-window': `${windows.desktop}px`");
    expect(read('src/components/landing/LogoStrip.tsx')).toContain("'--logo-fade': `${fade.desktop}px`");
  });

  it('on a phone the logos use the phone\'s gap, widths, window and fade, and the carousel keeps its single row', () => {
    const phone = '@media (max-width: 760px)';
    expect(decl('.logoStrip', phone)['--gap']).toBe('var(--logo-gap-phone)');
    expect(decl('.logoStrip', phone)['--maxh']).toBe('var(--logo-maxh-phone)');
    expect(decl('.logoStrip', phone)['--win']).toBe('var(--logo-window-phone)');
    expect(decl('.logoStrip', phone)['--fade']).toBe('var(--logo-fade-phone)');
    // the fade is narrower on a phone (the constants), and the phone does not override the pseudo-elements' width: it follows --fade
    expect(LOGO_STRIP_FADE.phone).toBeLessThan(LOGO_STRIP_FADE.desktop);
    expect(find('.logoStrip .logoWindow::before, .logoStrip .logoWindow::after', phone)).toEqual([]);
    expect(find('.logoStrip .logoList', phone)).toEqual([]); // nothing about the list changes: still one flex row
    expect(decl('.logoStrip .logoList').display).toBe('flex');
  });
});
