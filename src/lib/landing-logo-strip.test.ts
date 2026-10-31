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

describe('where the carousel sits', () => {
  const startups = read('src/app/page.tsx');
  const investors = read('src/app/investors/page.tsx');

  it('startups page: OUTSIDE the hero, after the dark bar of checks has closed with it, and before the features section — the first thing of the light area', () => {
    const hero = startups.indexOf('{/* ============ HERO ============ */}');
    const mock = startups.indexOf('<div className={s.mock}>');
    const checks = startups.indexOf('<div className={s.strip}>');
    const end = startups.indexOf('</header>');
    const strip = startups.indexOf('<LogoStrip page="startups" logos={logos} />');
    const features = startups.indexOf('{/* ============ FEATURES ============ */}');
    expect(count(startups, /<LogoStrip\b/g)).toBe(1);
    expect(hero).toBeGreaterThan(-1);
    expect(mock).toBeGreaterThan(hero);
    expect(checks).toBeGreaterThan(mock);
    expect(end).toBeGreaterThan(checks);
    expect(strip).toBeGreaterThan(end);
    expect(features).toBeGreaterThan(strip);
    // the bar of checks is the same bar, with its four checks, all of them inside the hero
    for (const t of ['Outreach discipline, enforced', 'One version of the truth', 'NDA-protected data room', 'AI drafts — you decide']) {
      const at = startups.indexOf(`<TickAmber />${t}`);
      expect(at, t).toBeGreaterThan(checks);
      expect(at, t).toBeLessThan(end);
    }
  });

  it('investors page (it has no bar of checks): outside the hero too, right after it and before the "Already in our database" section', () => {
    const mock = investors.indexOf('<div className={s.mock}>');
    const end = investors.indexOf('</header>');
    const strip = investors.indexOf('<LogoStrip page="investors" logos={logos} />');
    const claim = investors.indexOf('{/* ============ CLAIM ============ */}');
    expect(count(investors, /<LogoStrip\b/g)).toBe(1);
    expect(end).toBeGreaterThan(mock);
    expect(strip).toBeGreaterThan(end);
    expect(claim).toBeGreaterThan(strip);
    expect(investors).not.toContain('s.strip}'); // still no dark bar there: the logos are not standing in for one
  });

  it.each([['src/app/page.tsx', 'startups'], ['src/app/investors/page.tsx', 'investors']])('%s draws the carousel only when it has enough authorized logos, and the hero does not depend on it', (file, page) => {
    const src = read(file);
    expect(src).toContain(`const logos = landingLogosFor('${page}');`);
    expect(src).toContain('const withLogos = logoStripVisible(logos);');
    expect(src).toContain('{withLogos && <LogoStrip page="' + page + '" logos={logos} />}');
    expect(src).toContain('<header className={`${s.hero} ${s.heroCompact}`} id="top">');
    expect(src).not.toMatch(/heroWithLogos|landingWide/);
  });

  it('is a server component: no client code, no animation library, nothing from outside the project but React\'s types', () => {
    const src = read('src/components/landing/LogoStrip.tsx');
    expect(src).not.toMatch(/^\s*'use client'/m);
    expect(src).not.toMatch(/framer-motion|react-spring|gsap|swiper|embla|lottie|requestAnimationFrame|useEffect|useState/);
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['react', '@/content/site/logo-strip', '@/lib/landing-logos', '@/app/landing.module.css']);
  });
});

describe('the hero keeps the compact spacing it had on the live site (31/10/2026, Nuno: "recuperar aproximadamente a altura e os espaçamentos originais")', () => {
  const compact = css.filter((r) => r.selector.includes('heroCompact'));

  it('every such rule is written with the hero\'s own class in front, so it wins over the base rules whatever the order of the file', () => {
    expect(compact.length).toBeGreaterThanOrEqual(6);
    for (const r of compact) expect(r.selector.startsWith('.hero.heroCompact'), r.selector).toBe(true);
  });

  it('they set only vertical space — a top padding, a bottom padding, a bottom margin, the gap between rows — and, on a phone, the lead\'s line height: no font size, text, width, column or picture is touched, and nothing is stretched or centred to fill a height', () => {
    const props = new Set<string>();
    for (const r of compact) for (const k of Object.keys(declarations(r.body))) props.add(k);
    expect([...props].sort()).toEqual(['line-height', 'margin-bottom', 'padding-bottom', 'padding-top', 'row-gap']);
    // the line height is the one thing about text, it is only ever the lead's, only on a phone, and never tighter than 1.5
    const withLine = compact.filter((r) => 'line-height' in declarations(r.body));
    expect(withLine.map((r) => [r.selector, r.media])).toEqual([['.hero.heroCompact .lead', '@media (max-width: 900px)']]);
    expect(parseFloat(decl('.hero.heroCompact .lead', '@media (max-width: 900px)')['line-height'])).toBeGreaterThanOrEqual(1.5);
    // no min-height and no 100vh in the hero's rules, base or compact
    for (const r of css.filter((x) => x.selector.startsWith('.hero') || x.selector.startsWith('.mock'))) {
      expect(r.body, r.selector).not.toMatch(/min-height|100vh|100dvh|(?<![\w-])height\s*:/);
    }
  });

  it('each one is smaller than the value it overrides, so the hero only ever moves up; the top padding never goes under the 72 px nav', () => {
    const base = (sel: string, prop: string) => px(decl(sel)[prop]);
    const given = (sel: string, prop: string) => px(decl(sel)[prop]);
    expect(given('.hero.heroCompact', 'padding-top')).toBeLessThan(170);
    expect(given('.hero.heroCompact', 'padding-top')).toBeGreaterThanOrEqual(72 + 16);
    // the DIRECT .wrap (the grid): the dark bar of checks inside the hero has a .wrap of its own with 18 px of padding that a plain descendant selector would also have taken
    expect(given('.hero.heroCompact > .wrap', 'padding-bottom')).toBeLessThan(base('.hero .wrap', 'padding-bottom'));
    expect(css.some((r) => /^\.hero\.heroCompact \.wrap\b/.test(r.selector))).toBe(false);
    expect(given('.hero.heroCompact .badge', 'margin-bottom')).toBeLessThan(base('.badge', 'margin-bottom'));
    expect(given('.hero.heroCompact h1', 'margin-bottom')).toBeLessThan(base('.hero h1', 'margin-bottom'));
    expect(given('.hero.heroCompact .lead', 'margin-bottom')).toBeLessThan(base('.lead', 'margin-bottom'));
    expect(given('.hero.heroCompact .heroCtas', 'margin-bottom')).toBeLessThan(base('.heroCtas', 'margin-bottom'));
    expect(px(decl('.hero.heroCompact > .wrap', '@media (max-width: 900px)')['padding-bottom'])).toBeLessThan(80); // the base phone rule has 80
    // on a phone: less space between the text and the picture (one column: the grid gap is vertical), and the bar of checks keeps its own 18 px (".hero .wrap" with 80 px used to reach it too)
    expect(px(decl('.hero.heroCompact > .wrap', '@media (max-width: 900px)')['row-gap'])).toBeLessThan(48);
    expect(decl('.hero.heroCompact .strip .wrap', '@media (max-width: 900px)')).toEqual({ 'padding-bottom': '18px' });
  });

  it('on a phone the first screen starts higher and no further than the nav allows: 84 px of top padding (12 px clear of the 72 px nav), a little less between badge, title, lead and buttons, 10 px between buttons that wrap (Nuno, 31/10/2026)', () => {
    const phone = '@media (max-width: 900px)';
    expect(px(decl('.hero.heroCompact', phone)['padding-top'])).toBe(84);
    expect(px(decl('.hero.heroCompact', phone)['padding-top'])).toBeGreaterThanOrEqual(72 + 12);
    expect(px(decl('.hero.heroCompact', phone)['padding-top'])).toBeLessThan(px(decl('.hero.heroCompact')['padding-top']));
    for (const [sel, prop, value] of [['.hero.heroCompact .badge', 'margin-bottom', 12], ['.hero.heroCompact h1', 'margin-bottom', 10], ['.hero.heroCompact .lead', 'margin-bottom', 16]] as const) {
      expect(px(decl(sel, phone)[prop]), sel).toBe(value);
      expect(px(decl(sel, phone)[prop]), sel).toBeLessThan(px(decl(sel)[prop])); // each is a little less than the laptop's compact value
    }
    // The 28 px between the text and the picture are kept: the picture's floating "Fact confirmed" chip sits ~30 px above it, over the text block; with 20 px it came down onto "Free to start" (measured)
    expect(px(decl('.hero.heroCompact > .wrap', phone)['row-gap'])).toBe(28);
    expect(decl('.hero.heroCompact .heroCtas', phone)).toEqual({ 'row-gap': '10px' }); // only the row gap: two buttons side by side keep their 14 px
    // nothing here fixes a height or scales the hero
    expect(read('src/app/landing.module.css')).not.toMatch(/\.hero[^{]*\{[^}]*(min-height|(?<![\w-])height\s*:|transform:\s*scale|zoom\s*:)/);
  });

  it('the base rules are untouched (170 px under the nav, 110 px under the content, the same margins and sizes), so the other public pages that share the stylesheet keep their hero', () => {
    expect(decl('.hero').padding).toBe('170px 0 0');
    expect(decl('.hero .wrap')['padding-bottom']).toBe('110px');
    expect(decl('.hero .wrap')['grid-template-columns']).toBe('1.05fr .95fr');
    expect(decl('.hero .wrap').gap).toBe('48px');
    expect(decl('.badge')['margin-bottom']).toBe('22px');
    expect(decl('.badge')['font-size']).toBe('.82rem');
    expect(decl('.hero h1')['font-size']).toBe('clamp(2.4rem, 5vw, 3.7rem)');
    expect(decl('.hero h1')['margin-bottom']).toBe('20px');
    expect(decl('.lead')['font-size']).toBe('1.13rem');
    expect(decl('.lead')['margin-bottom']).toBe('32px');
    expect(decl('.heroCtas')['margin-bottom']).toBe('28px');
    expect(decl('.heroNote')['font-size']).toBe('.85rem');
    expect(decl('.strip').background).toBe('var(--ink)');
    expect(decl('.strip .wrap').padding).toBe('18px 24px');
  });

  it('the content column is the 1140 px it always was: the wide column is gone', () => {
    expect(decl('.wrap')['max-width']).toBe('1140px');
    expect(read('src/app/landing.module.css')).not.toMatch(/landingWide/);
  });

  it('the first paragraph under the title has its compact 10 px margin again', () => {
    expect(read('src/app/page.tsx')).toContain('<p className={s.lead} style={{ marginBottom: 10 }}>');
  });
});

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
    expect(decl('.logoStrip')).toEqual({ '--gap': 'var(--logo-gap)', '--maxh': 'var(--logo-maxh)', '--win': 'var(--logo-window)', '--fade': 'var(--logo-fade)', padding: '40px 0 0' });
    const img = decl('.logoStrip .logoImg');
    expect(img.width).toBe('calc(var(--w) * 1px)');
    expect(img.height).toBe('auto');
    expect(decl('.logoStrip .logoImg', '@media (max-width: 760px)').width).toBe('calc(var(--wp) * 1px)');
    expect(read('src/app/landing.module.css')).not.toMatch(/\.logoInner|\.logoHead|\.logoLabel/);
  });

  it('what follows the carousel starts with a moderate space: less than the 96 px a section normally begins with (46 px, 36 px on a phone), and the claim section loses its top line there', () => {
    expect(decl('.sec').padding).toBe('96px 0');
    expect(decl('.logoStrip + .sec')).toEqual({ 'padding-top': '46px' });
    expect(decl('.logoStrip + .sec', '@media (max-width: 760px)')).toEqual({ 'padding-top': '36px' });
    expect(declarations(find('.logoStrip + .claimSec')[0].body)['border-top']).toBe('0');
  });

  it('the title is a centred line of the page\'s own heading font and ink, a little smaller than a section heading, right above the carousel; ink on --bg passes WCAG AAA', () => {
    const t = decl('.logoStrip .logoTitle');
    expect(t['text-align']).toBe('center');
    expect(t['font-size']).toBe('clamp(1.15rem, 1.4vw + .75rem, 1.5rem)');
    expect(t['margin-bottom']).toBe('10px');
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
