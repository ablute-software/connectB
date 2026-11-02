// Prompt 934 (02/11/2026, Nuno on a phone: "Sign in" and "Create account" were out of the screen) — the phone/tablet header (Menu button and panel), the bar fixed to the bottom of the screen, and the header's
// "Sign in" that was dark on dark. The pure rules are pinned here; the stylesheet is pinned at the source (like landing-logo-strip.test.ts: a selector's specificity, a property that is or is not in a rule is not
// something a unit test sees any other way); the pages' wiring is pinned from their source. What a browser does with it all — the bar coming in once the hero's buttons leave the screen, the Menu opening and
// closing on Esc / a tap outside / a link, the footer not covered, no layout shift — was measured on the real pages and is in docs/screenshots-934/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_FLAG_ATTR, HERO_CTAS_ATTR, HERO_CTAS_SELECTOR, MENU_PANEL_ID, MOBILE_NAV_MAX_WIDTH, NAV_HEIGHT, barVisible, isCloseKey, isOutsideMenu } from './landing-mobile-nav';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

interface Rule { selector: string; body: string; media: string | null }
/** The rules of a stylesheet, with the @media they sit in; comments gone. */
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
const rules = parseCss(read('src/app/landing.module.css'));
const find = (selector: string, media: string | null = null) => rules.filter((r) => r.selector === selector && r.media === media);
const decl = (selector: string, media: string | null = null) => { const r = find(selector, media); expect(r, `${selector} @ ${media}`).toHaveLength(1); return declarations(r[0].body); };
const PHONE = '@media (max-width: 900px)';

describe('the pure rules', () => {
  it('the bar is on screen only for a visitor who is not signed in and only once the hero\'s own buttons are NOT on screen; before they are measured it is hidden (the server render and the first client render are the same)', () => {
    expect(barVisible(null, false)).toBe(false); // not measured yet
    expect(barVisible(true, false)).toBe(false); // the hero's buttons are there: the bar would say the same thing twice
    expect(barVisible(false, false)).toBe(true); // they have left the screen (or never were on it)
    for (const on of [null, true, false] as const) expect(barVisible(on, true), `signed in, buttons ${on}`).toBe(false); // never for a signed-in visitor
  });

  it('a tap is outside the menu unless it lands on the button or inside the panel; Esc is the close key', () => {
    const node = (children: unknown[] = []) => ({ contains: (n: unknown) => children.includes(n) } as unknown as Node);
    const inPanel = {} as Node; const inButton = {} as Node; const elsewhere = {} as Node;
    const button = node([inButton]); const panel = node([inPanel]);
    expect(isOutsideMenu(inPanel, button, panel)).toBe(false);
    expect(isOutsideMenu(inButton, button, panel)).toBe(false);
    expect(isOutsideMenu(elsewhere, button, panel)).toBe(true);
    expect(isOutsideMenu(elsewhere, null, null)).toBe(true);
    expect(isOutsideMenu(null, button, panel)).toBe(false);
    expect(isCloseKey('Escape')).toBe(true);
    for (const k of ['Enter', 'Tab', ' ', 'esc', 'ArrowDown']) expect(isCloseKey(k), k).toBe(false);
  });

  it('the constants say what the stylesheet says: 900 px, a 72 px header, one id, one attribute on <html>', () => {
    expect(MOBILE_NAV_MAX_WIDTH).toBe(900);
    expect(NAV_HEIGHT).toBe(72);
    expect(decl('.nav .wrap').height).toBe('72px');
    expect(MENU_PANEL_ID).toBe('landing-menu-panel');
    expect(HERO_CTAS_ATTR).toBe('data-hero-ctas');
    expect(HERO_CTAS_SELECTOR).toBe('[data-hero-ctas]');
    expect(BAR_FLAG_ATTR).toBe('data-landing-bar');
    expect(find('.hero .wrap', PHONE)).toHaveLength(1); // the same 900 px line where the hero becomes one column
  });
});

describe('the header\'s "Sign in" and the Startups/Investors selector are readable on the dark header (§C)', () => {
  it('".landing a { color: inherit }" beats a bare class, so the nav\'s ghost button and the unselected option are qualified with .nav; the selected option keeps its ink on amber, and the scrolled (white) header keeps its own variants', () => {
    expect(decl('.landing a').color).toBe('inherit');
    expect(decl('.nav .btnGhost')).toEqual({ color: '#fff' });
    expect(decl('.nav .audienceOpt')).toEqual({ color: 'rgba(255, 255, 255, .8)' });
    expect(decl('.nav .audienceOptOn')).toEqual({ color: 'var(--ink)' });
    // the white-header variants are more specific (three classes) and stay
    expect(decl(".nav[data-scrolled='true'] .btnGhost")).toEqual({ 'border-color': 'var(--line)', color: 'var(--ink)' });
    expect(decl(".nav[data-scrolled='true'] .audienceOpt").color).toBe('var(--muted)');
    expect(decl(".nav[data-scrolled='true'] .audienceOptOn").color).toBe('#fff');
    // the unselected option's rule comes BEFORE the hover ones and the selected one's AFTER the unselected one (same specificity: the later wins)
    const order = rules.map((r) => r.selector);
    expect(order.indexOf('.nav .audienceOpt')).toBeLessThan(order.indexOf('.audienceOpt:hover'));
    expect(order.indexOf('.nav .audienceOptOn')).toBeGreaterThan(order.indexOf('.nav .audienceOpt'));
    expect(order.indexOf('.nav .audienceOptOn')).toBeLessThan(order.indexOf('.audienceOptOn:hover'));
  });
});

describe('the phone / tablet header: the Menu button replaces the row of links, selector and buttons (§B)', () => {
  it('up to 900 px the whole row leaves the header; the Menu button is not drawn above that', () => {
    expect(decl('.navLinks', PHONE)).toEqual({ display: 'none' });
    expect(decl('.nav .menuBtn').display).toBe('none');
    expect(decl('.nav .menuBtn', PHONE)).toEqual({ display: 'inline-flex' });
    expect(decl('.nav .menuPanel').display).toBe('none');
  });

  it('the Menu button is a 44 px target with an icon and a word, in the header\'s own colours (white on the dark header, ink on the white one)', () => {
    const b = decl('.nav .menuBtn');
    expect(b['min-height']).toBe('44px');
    expect(b['min-width']).toBe('44px');
    expect(b.color).toBe('#fff');
    expect(b.border).toBe('1.5px solid rgba(255, 255, 255, .35)');
    expect(decl(".nav[data-scrolled='true'] .menuBtn")).toEqual({ 'border-color': 'var(--line)', color: 'var(--ink)' });
  });

  it('the panel hangs from the header (absolute under it, the header being the fixed one — never a full-window overlay), dark under the transparent header and light under the white one, scrolling on its own in a short window', () => {
    const open = decl(".nav .menuPanel[data-open='true']", PHONE);
    expect(open.display).toBe('block');
    expect(open.position).toBe('absolute');
    expect(open.top).toBe('100%');
    expect(open.left).toBe('0');
    expect(open.right).toBe('0');
    expect(open['overflow-y']).toBe('auto');
    expect(open['max-height']).toBe('calc(100svh - 72px)');
    expect(open.background).toBe('var(--ink)'); // solid: at 98% the hero's headline showed through it as a ghost
    expect(decl(".nav[data-scrolled='true'] .menuPanel[data-open='true']", PHONE).background).toBe('#fff');
    expect(open.position).not.toBe('fixed'); // the project's createPortal rule is about full-window fixed overlays
    expect(rules.some((r) => /inset:\s*0/.test(r.body) && /menu/i.test(r.selector))).toBe(false);
  });

  it('the selector in the panel is one line (the two options share the width and never wrap) and the buttons are 44 px tall', () => {
    expect(decl('.nav .menuAudience .audience', PHONE).width).toBe('100%');
    const opt = decl('.nav .menuAudience .audienceOpt', PHONE);
    expect(opt.flex).toBe('1 1 0');
    expect(opt['white-space']).toBe('nowrap');
    expect(decl('.nav .menuActions .btn', PHONE)['min-height']).toBe('44px');
    expect(decl('.nav .menuLink', PHONE)['min-height']).toBe('48px');
  });
});

describe('the bar fixed to the bottom (§A)', () => {
  const base = () => decl('.landing .mobileBar');
  const phone = () => decl('.landing .mobileBar', PHONE);

  it('it is not drawn from 901 px up (base display none; display flex only inside the 900 px block)', () => {
    expect(base()).toEqual({ display: 'none' });
    expect(phone().display).toBe('flex');
    expect(rules.filter((r) => r.selector.includes('mobileBar') && r.media === null && /display:\s*flex/.test(r.body))).toEqual([]);
  });

  it('it is fixed to the bottom, the whole width, under the header\'s z-index, the hero\'s blue at 92% with an 8 px blur and a thin line on top, at least 56 px tall plus the safe area', () => {
    const p = phone();
    expect(p.position).toBe('fixed');
    expect(p.left).toBe('0');
    expect(p.right).toBe('0');
    expect(p.bottom).toBe('0');
    expect(Number(p['z-index'])).toBeLessThan(Number(decl('.nav')['z-index'])); // under the header: an open Menu panel is never half covered by the bar
    expect(p.background).toBe('rgba(12, 39, 46, .92)');
    expect(read('src/app/landing.module.css')).toMatch(/--ink:\s*#0c272e/i); // 12, 39, 46 is the ink of the hero
    expect(p['backdrop-filter']).toBe('blur(8px)');
    expect(p['-webkit-backdrop-filter']).toBe('blur(8px)');
    expect(p['border-top']).toBe('1px solid rgba(255, 255, 255, .14)');
    expect(p['min-height']).toBe('var(--bar-h)');
    expect(decl('.landing', PHONE)['--bar-h']).toBe('calc(56px + env(safe-area-inset-bottom, 0px))');
    expect(p.padding).toBe('6px 16px calc(6px + env(safe-area-inset-bottom, 0px))');
    expect(p['box-sizing']).toBe('border-box');
    expect(p.gap).toBe('12px');
  });

  it('it comes and goes with transform, opacity and visibility ONLY, in 200 ms, so it can never push the page (CLS 0); out of sight it is also out of the tab order; "reduce motion" removes the transition', () => {
    const p = phone();
    expect(p.transform).toBe('translateY(100%)');
    expect(p.opacity).toBe('0');
    expect(p.visibility).toBe('hidden');
    expect(p.transition).toBe('transform .2s ease, opacity .2s ease, visibility 0s linear .2s');
    expect(decl(".landing .mobileBar[data-visible='true']", PHONE)).toEqual({ transform: 'none', opacity: '1', visibility: 'visible', 'transition-delay': '0s' });
    for (const prop of ['top', 'height', 'width', 'margin', 'margin-top', 'margin-bottom']) expect(Object.keys(p), prop).not.toContain(prop);
    expect(decl('.landing .mobileBar', '@media (prefers-reduced-motion: reduce)')).toEqual({ transition: 'none' });
  });

  it('its two buttons share the width (ghost one white, gold one with the page\'s ink), 44 px tall', () => {
    expect(decl('.landing .mobileBar .btn', PHONE)).toEqual({ flex: '1 1 0', 'min-height': '44px' });
    expect(decl('.landing .mobileBar .btnGhost', PHONE)).toEqual({ color: '#fff' });
    expect(decl('.landing .mobileBar .btnPrimary', PHONE)).toEqual({ color: 'var(--ink)' });
  });

  it('while the page carries the bar the footer — the last thing on the page — has room for it (its own 40 px plus the bar\'s height), so nothing is covered at the end', () => {
    expect(decl('.footerEl').padding).toBe('56px 0 40px');
    const f = find(":global(html[data-landing-bar='on']) .footerEl", PHONE);
    expect(f).toHaveLength(1);
    expect(declarations(f[0].body)).toEqual({ 'padding-bottom': 'calc(40px + var(--bar-h))' });
  });

  it('every rule added for this is under .nav or .landing (".landing *" resets margin and padding and ".landing a" beats a bare class), or scoped to the flag on <html>', () => {
    const mine = rules.filter((r) => /menu(Btn|Panel|List|Link|Audience|Actions)|mobileBar|data-landing-bar/.test(r.selector));
    expect(mine.length).toBeGreaterThanOrEqual(15);
    for (const r of mine) expect(/^(\.nav|\.landing|:global\(html\[data-landing-bar)/.test(r.selector), r.selector).toBe(true);
  });

  it('nothing else about the landing changes: no new colour (only the page\'s own ink, amber, line and white), no font family or size beyond the Menu button and links, and the header stays fixed', () => {
    expect(decl('.nav').position).toBe('fixed');
    const added = rules.filter((r) => /menu(Btn|Panel|List|Link|Audience|Actions)|mobileBar/.test(r.selector));
    for (const r of added) {
      expect(Object.keys(declarations(r.body)), r.selector).not.toContain('font-family');
      expect(r.body, r.selector).not.toMatch(/#[0-9a-f]{3,8}\b(?<!#fff)/i); // no hex colour other than white
    }
  });
});

describe('the pages\' wiring', () => {
  const startups = read('src/app/page.tsx');
  const investors = read('src/app/investors/page.tsx');

  it('the hero\'s row of buttons carries data-hero-ctas on both pages, once each and inside the hero — the row the bar watches', () => {
    for (const [name, src] of [['startups', startups], ['investors', investors]] as const) {
      expect(count(src, /data-hero-ctas/g), name).toBe(1);
      const hero = src.slice(src.indexOf('id="top">'), src.indexOf('</header>'));
      expect(hero, name).toContain('<div className={s.heroCtas} data-hero-ctas>');
    }
  });

  it('startups: Menu with Features / How it works / Pricing, the selector and the page\'s own buttons; the bar with /login and /signup', () => {
    expect(startups).toContain("<LandingMenu links={[{ label: 'Features', href: '#features' }, { label: 'How it works', href: '#how' }, { label: 'Pricing', href: '#pricing' }]} signInHref=\"/login\" createHref=\"/signup\">");
    expect(startups).toContain('<LandingMobileBar signedIn={signedIn} signInHref="/login" createHref="/signup" />');
    expect(count(startups, /<AudienceToggle active="startup" \/>/g)).toBe(2); // the header's own (hidden up to 900 px) and the panel's
  });

  it('investors: the same, with the investors\' order of links, "Sign in" to /login?as=investor and "Create account" where the header\'s primary button goes (the claim flow)', () => {
    expect(investors).toContain("<LandingMenu links={[{ label: 'How it works', href: '#how' }, { label: 'Features', href: '#features' }, { label: 'Pricing', href: '#pricing' }]} signInHref=\"/login?as=investor\" createHref={CLAIM_HREF}>");
    expect(investors).toContain('<LandingMobileBar signedIn={signedIn} signInHref="/login?as=investor" createHref={CLAIM_HREF} />');
    expect(count(investors, /<AudienceToggle active="investor" \/>/g)).toBe(2);
  });

  it('"signed in" is the answer of the getUser() that already decides the redirect: set inside `if (user)`, before it; no cookie read and no request from the landing for it', () => {
    for (const [name, src] of [['startups', startups], ['investors', investors]] as const) {
      expect(src, name).toContain('let signedIn = false;');
      const at = src.indexOf('if (user) {');
      expect(at, name).toBeGreaterThan(src.indexOf('let signedIn = false;'));
      expect(src.slice(at, at + 80), name).toContain('signedIn = true;');
      expect(src.indexOf('signedIn = true;'), name).toBeLessThan(src.indexOf('redirect(dest)'));
    }
  });

  it('the two components are client components with nothing that talks to the server: no fetch, no cookie, no Supabase client, no browser storage', () => {
    for (const file of ['src/components/landing/LandingMobileBar.tsx', 'src/components/landing/LandingMenu.tsx']) {
      const src = read(file);
      expect(src, file).toMatch(/^'use client';/);
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, file).not.toMatch(/fetch\(|document\.cookie|browserClient|supabase|localStorage|sessionStorage|XMLHttpRequest|createPortal/);
    }
    // (the loop above also rules out createPortal in the code: the bar sits in the page, inside .landing, and the menu hangs from the header — neither is a full-window overlay)
  });

  it('the logo strip, the hero and the rest of the landing were not touched: this change adds the two components and the hook, and no section, text or colour', () => {
    expect(startups).toContain('<header className={`${s.hero} ${s.heroCompact}`} id="top">');
    expect(startups).toContain("{withLogos && <LogoStrip page=\"startups\" logos={logos} />}");
    expect(investors).toContain("{withLogos && <LogoStrip page=\"investors\" logos={logos} />}");
    expect(read('src/components/landing/LogoStrip.tsx')).not.toMatch(/mobileBar|menuBtn|landing-mobile-nav/);
  });
});
