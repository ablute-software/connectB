// Prompt 926 (30/10/2026) — where the strip of logos sits on the two landing pages, what the hero gives up to make room for it, and the stylesheet's promises
// (transform-only motion, still on hover, still under "reduce motion", edges that fade to white). Pinned at the source, like landing-contrast.test.ts, because none
// of it is visible to a unit test's natural field of view: it is a selector's specificity, an order of tags, a property that is or is not in a rule. The measured
// side of the same promises — the strip fully visible without scrolling at 1280x720, 1366x768, 1440x900 and 1920x1080 — is in docs/screenshots-926/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

interface Rule { selector: string; body: string; media: string | null }
/** The rules of a stylesheet, with the @media they sit in; comments gone. @keyframes come back as one rule whose selector is the whole @keyframes line. */
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
      if (head.startsWith('@media')) walk(inner, head);
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
const px = (v: string) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v)?.[1]);

describe('where the strip sits', () => {
  const startups = read('src/app/page.tsx');
  const investors = read('src/app/investors/page.tsx');

  it('startups page: after the top block (title, text, buttons, pipeline picture) and before the dark bar of checks, inside the hero', () => {
    const hero = startups.indexOf('{/* ============ HERO ============ */}');
    const mock = startups.indexOf('<div className={s.mock}>');
    const strip = startups.indexOf('<LogoStrip page="startups" logos={logos} />');
    const checks = startups.indexOf('<div className={s.strip}>');
    const end = startups.indexOf('</header>');
    expect(count(startups, /<LogoStrip\b/g)).toBe(1);
    expect(hero).toBeGreaterThan(-1);
    expect(mock).toBeGreaterThan(hero);
    expect(strip).toBeGreaterThan(mock);
    expect(checks).toBeGreaterThan(strip);
    expect(end).toBeGreaterThan(checks);
    // the bar of checks is still the same bar, right after the strip, with its four checks
    for (const t of ['Outreach discipline, enforced', 'One version of the truth', 'NDA-protected data room', 'AI drafts — you decide']) expect(startups.indexOf(`<TickAmber />${t}`)).toBeGreaterThan(checks);
  });

  it('investors page (it has no bar of checks): after the top block, at the foot of the hero, before the "Already in our database" section', () => {
    const mock = investors.indexOf('<div className={s.mock}>');
    const strip = investors.indexOf('<LogoStrip page="investors" logos={logos} />');
    const end = investors.indexOf('</header>');
    const claim = investors.indexOf('{/* ============ CLAIM ============ */}');
    expect(count(investors, /<LogoStrip\b/g)).toBe(1);
    expect(strip).toBeGreaterThan(mock);
    expect(end).toBeGreaterThan(strip);
    expect(claim).toBeGreaterThan(end);
    expect(investors).not.toContain('s.strip}'); // still no dark bar there: the strip is not standing in for one
  });

  it.each([['src/app/page.tsx', 'startups'], ['src/app/investors/page.tsx', 'investors']])('%s draws the strip only when it has enough authorized logos, and moves the hero up only then', (file, page) => {
    const src = read(file);
    expect(src).toContain(`const logos = landingLogosFor('${page}');`);
    expect(src).toContain('const withLogos = logoStripVisible(logos);');
    expect(src).toContain('{withLogos && <LogoStrip page="' + page + '" logos={logos} />}');
    expect(src).toContain('<header className={withLogos ? `${s.hero} ${s.heroWithLogos}` : s.hero} id="top">');
    expect(count(src, /heroWithLogos/g)).toBe(1);
  });

  it('is a server component: no client code, no animation library, nothing from outside the project but React\'s types', () => {
    const src = read('src/components/landing/LogoStrip.tsx');
    expect(src).not.toMatch(/^\s*'use client'/m);
    expect(src).not.toMatch(/framer-motion|react-spring|gsap|swiper|embla|lottie|requestAnimationFrame|useEffect|useState/);
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['react', '@/content/site/logo-strip', '@/lib/landing-logos', '@/app/landing.module.css']);
  });
});

describe('what the hero gives up to make room: vertical space, nothing else, and only while the strip is drawn', () => {
  const compress = css.filter((r) => r.selector.includes('heroWithLogos'));

  it('every such rule is written with the hero\'s own class in front, so it wins over the base rules whatever the order of the file', () => {
    expect(compress.length).toBeGreaterThanOrEqual(6);
    for (const r of compress) expect(r.selector.startsWith('.hero.heroWithLogos'), r.selector).toBe(true);
  });

  it('and they set only a top padding, a bottom padding or a bottom margin: no font size, text, width, column, gap or picture is touched', () => {
    const props = new Set<string>();
    for (const r of compress) for (const k of Object.keys(declarations(r.body))) props.add(k);
    expect([...props].sort()).toEqual(['margin-bottom', 'padding-bottom', 'padding-top']);
  });

  it('each one is smaller than the value it overrides, so the hero only ever moves up', () => {
    const base = (sel: string, prop: string) => px(declarations(find(sel)[0].body)[prop]);
    const given = (sel: string, prop: string) => px(declarations(find(sel)[0].body)[prop]);
    expect(given('.hero.heroWithLogos', 'padding-top')).toBeLessThan(170);
    expect(given('.hero.heroWithLogos', 'padding-top')).toBeGreaterThanOrEqual(72 + 16); // the nav is 72 px tall: never under it
    // the DIRECT .wrap (the grid): the dark bar of checks inside the hero has a .wrap of its own with 18 px of padding that a plain descendant selector would also have taken
    expect(given('.hero.heroWithLogos > .wrap', 'padding-bottom')).toBeLessThan(base('.hero .wrap', 'padding-bottom'));
    expect(css.some((r) => /^\.hero\.heroWithLogos \.wrap\b/.test(r.selector))).toBe(false);
    expect(given('.hero.heroWithLogos .badge', 'margin-bottom')).toBeLessThan(base('.badge', 'margin-bottom'));
    expect(given('.hero.heroWithLogos h1', 'margin-bottom')).toBeLessThan(base('.hero h1', 'margin-bottom'));
    expect(given('.hero.heroWithLogos .lead', 'margin-bottom')).toBeLessThan(base('.lead', 'margin-bottom'));
    expect(given('.hero.heroWithLogos .heroCtas', 'margin-bottom')).toBeLessThan(base('.heroCtas', 'margin-bottom'));
  });

  it('the base rules are the ones the page always had (170 px under the nav, 110 px under the content, the same margins and the same sizes): the page is unchanged while the strip is not drawn', () => {
    const d = (sel: string) => declarations(find(sel)[0].body);
    expect(d('.hero').padding).toBe('170px 0 0');
    expect(d('.hero .wrap')['padding-bottom']).toBe('110px');
    expect(d('.badge')['margin-bottom']).toBe('22px');
    expect(d('.badge')['font-size']).toBe('.82rem');
    expect(d('.hero h1')['font-size']).toBe('clamp(2.4rem, 5vw, 3.7rem)');
    expect(d('.hero h1')['margin-bottom']).toBe('20px');
    expect(d('.lead')['font-size']).toBe('1.13rem');
    expect(d('.lead')['margin-bottom']).toBe('32px');
    expect(d('.heroCtas')['margin-bottom']).toBe('28px');
    expect(d('.heroNote')['font-size']).toBe('.85rem');
    expect(d('.hero .wrap')['grid-template-columns']).toBe('1.05fr .95fr');
  });
});

describe('the strip\'s stylesheet', () => {
  const strip = css.filter((r) => /\.logo[A-Z]/.test(r.selector) && !r.selector.startsWith('@keyframes'));

  it('every rule is under .logoStrip (".landing *" resets margin and padding at (0,1,0): a lone class would only tie with it and win or lose by the order of the files)', () => {
    expect(strip.length).toBeGreaterThan(10);
    for (const r of strip) for (const part of r.selector.split(',')) expect(part.trim().startsWith('.logoStrip'), part).toBe(true);
  });

  it('the motion is transform only: the keyframes touch nothing else, so nothing can move with it', () => {
    const k = css.find((r) => r.selector === '@keyframes logoLoop');
    expect(k).toBeDefined();
    const props = new Set([...k!.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    expect([...props]).toEqual(['transform']);
    expect(k!.body).toContain('translateX(0)');
    expect(k!.body).toContain('translateX(calc(-100% / var(--logo-copies)))'); // exactly one copy of the list: no jump at the end of the turn
  });

  it('the track turns at a constant speed (linear), forever, from the one time constant, and is promoted to its own layer', () => {
    const track = declarations(find('.logoStrip .logoTrack')[0].body);
    expect(track.animation).toBe('logoLoop var(--logo-loop) linear infinite');
    expect(track['will-change']).toBe('transform');
    expect(track.width).toBe('max-content');
  });

  it('it stops while the pointer is over it', () => {
    expect(declarations(find('.logoStrip .logoWindow:hover .logoTrack')[0].body)['animation-play-state']).toBe('paused');
  });

  it('under "reduce motion" it stands still, in one row of whole logos, without the copies that only exist for the seam', () => {
    const media = '@media (prefers-reduced-motion: reduce)';
    const track = declarations(find('.logoStrip .logoTrack', media)[0].body);
    expect(track.animation).toBe('none');
    const list = declarations(find('.logoStrip .logoList', media)[0].body);
    expect(list['flex-wrap']).toBe('wrap');
    expect(list.overflow).toBe('hidden');
    expect(list.height).toBe('var(--h)');
    expect(declarations(find(".logoStrip .logoList[aria-hidden='true']", media)[0].body).display).toBe('none');
  });

  it('both ends fade into the white band, and the fade never catches a click or a hover', () => {
    const before = declarations(find('.logoStrip .logoWindow::before')[0].body);
    const after = declarations(find('.logoStrip .logoWindow::after')[0].body);
    expect(before.background).toBe('linear-gradient(to right, #fff, rgba(255, 255, 255, 0))');
    expect(after.background).toBe('linear-gradient(to left, #fff, rgba(255, 255, 255, 0))');
    const shared = declarations(find('.logoStrip .logoWindow::before, .logoStrip .logoWindow::after')[0].body);
    expect(shared['pointer-events']).toBe('none');
  });

  it('the band is white, the logos have a fixed height and a largest width, and the colours are the files\' own', () => {
    expect(declarations(find('.logoStrip')[0].body).background).toBe('#fff');
    const img = declarations(find('.logoStrip .logoImg')[0].body);
    expect(img.height).toBe('var(--h)');
    expect(img['max-width']).toBe('var(--maxw)');
    expect(img['object-fit']).toBe('contain');
    expect(Object.keys(img).filter((k) => /filter|opacity|mix-blend|grayscale/.test(k))).toEqual([]);
  });

  it('the label is small and grey, on the left of the logos (above them on a phone), in the colour the page already uses for small print', () => {
    const label = declarations(find('.logoStrip .logoLabel')[0].body);
    expect(label.color).toBe('var(--muted)');
    expect(label['font-size']).toBe('.78rem');
    const phone = css.filter((r) => r.media === '@media (max-width: 760px)').map((r) => r.selector);
    expect(phone).toContain('.logoStrip .logoInner');
    expect(declarations(find('.logoStrip .logoInner', '@media (max-width: 760px)')[0].body)['flex-direction']).toBe('column');
  });
});
