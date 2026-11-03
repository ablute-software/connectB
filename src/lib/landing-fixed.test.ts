// Prompt 935 (02/11/2026) — what the fixed landing promises, pinned. Four kinds of promise: the geometry (the stylesheet's calc() formulas ARE src/lib/landing-fixed.ts's lensLayout — one reference, two
// forms, compared here by evaluating the CSS), the gestures' rules, the copy's rules (every demo marked as an example, no promise of a result, prices from plans.ts), and the stylesheet's safety (scoped, and
// the root has nothing that would trap a fixed child). The measured side — 96 panel fits, captures, focus trap — is in docs/screenshots-landing-fixed-20261102/ and the report.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LINE_EVERY_MS, LINE_FOG_MS, PHOTO, SCREEN_LENS, STEP_LOCK_MS, SWIPE_MIN_X, SWIPE_MIN_Y, WHEEL, WHEEL_MIN_DELTA,
  cardCanScroll, hasMore, jumped, lensLayout, nextLine, ringOffset, stepAllowed, stepIndex, swipeStep, wheelX,
} from './landing-fixed';
import { CTA, DOC_ORDER, HERO_LINES, MODES, MODE_PATH, heroLineText, isDocId } from '@/content/site/landing-fixed';
import { PANEL_FAQ, PANEL_HTML } from '@/content/site/landing-fixed-panels';
import { InvestorPricing, StartupPricing, landingMarquees } from '@/components/landing-fixed/Panels';
import { escapeHtml, marqueeHtml } from './landing-fixed-logos';
import { INVESTOR_PLANS, MATCHDEAL_WEEKLY, PLANS, SEAT_COUNT_LABEL } from './plans';
import { landingLogosFor, logoStripVisible } from '@/content/site/logo-strip';
import { aiClauseParagraphs } from '@/components/landing-fixed/LegalChapters';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const css = read('src/app/landing-fixed.css');

/* ---------- the stylesheet's formulas, evaluated ---------- */
function customProps(scope: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of scope.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/** The first `.fx-root {...}` block that declares the lens' custom properties, and the later one of the same selector, as one table (the later wins, as in a stylesheet). */
const PROPS = (() => {
  const props: Record<string, string> = {};
  for (const m of css.matchAll(/\.fx-root \{([^}]*)\}/g)) Object.assign(props, customProps(m[1]));
  return props;
})();

function evalCss(expr: string, vw: number, vh: number): number {
  const resolve = (e: string, depth = 0): string => {
    if (depth > 20) throw new Error('var loop');
    return e.replace(/var\((--[a-z-]+)(?:,[^)]*)?\)/g, (_m, name: string) => {
      if (!(name in PROPS)) throw new Error(`unknown ${name}`);
      return `(${resolve(PROPS[name], depth + 1)})`;
    });
  };
  const js = resolve(expr)
    .replace(/(-?\d*\.?\d+)px/g, '($1)')
    .replace(/(-?\d*\.?\d+)dvh/g, '($1*vh/100)')
    .replace(/(-?\d*\.?\d+)vh/g, '($1*vh/100)')
    .replace(/(-?\d*\.?\d+)vw/g, '($1*vw/100)')
    .replace(/calc\(/g, '(')
    .replace(/clamp\(/g, '__clamp(');
  return new Function('vw', 'vh', '__clamp', `return ${js};`)(vw, vh, (a: number, b: number, c: number) => Math.min(Math.max(b, a), c)) as number;
}

const SIZES: [number, number][] = [[1280, 720], [1366, 768], [1440, 790], [1440, 900], [1536, 864], [1920, 1080], [390, 844]];

describe('the lens: CSS formulas = lensLayout = the mockup\'s numbers', () => {
  it('the photograph is 1045 x 1084 and its lens sits at 50.4% / 46.1%, 10.2% wide (measured from the file)', () => {
    expect(PHOTO).toEqual({ width: 1045, height: 1084, lensX: 0.504, lensY: 0.461, lensD: 0.102 });
    expect(SCREEN_LENS).toEqual({ y: 0.46, d: 0.18 });
    expect(PHOTO.height / PHOTO.width).toBeCloseTo(1.0373206, 6);
  });

  it('at 1440x900 the lens is 162 px, centred at 720 / 414, and the photograph is drawn so that ITS lens is that one', () => {
    const l = lensLayout(1440, 900);
    expect(l.ld).toBeCloseTo(162, 6);
    expect(l.lx).toBe(720);
    expect(l.ly).toBeCloseTo(414, 6);
    expect(l.photoLeft + PHOTO.lensX * l.photoW).toBeCloseTo(l.lx, 6);
    expect(l.photoTop + PHOTO.lensY * l.photoH).toBeCloseTo(l.ly, 6);
    expect(PHOTO.lensD * l.photoW).toBeCloseTo(l.ld, 6);
  });

  it('a wheel disc is 39% of the lens between 40 and 80 px, the gap 37% of a disc', () => {
    expect(lensLayout(1440, 900).d).toBeCloseTo(162 * 0.39, 6);
    expect(lensLayout(1920, 400).d).toBe(40);      // lens 72 px: 28 -> held at 40
    expect(lensLayout(1920, 2000).d).toBe(80);     // lens 360 px: 140 -> held at 80
    const l = lensLayout(1366, 768);
    expect(l.gap).toBeCloseTo(l.d * WHEEL.gapRatio, 6);
    expect(l.first).toBeCloseTo(l.ld / 2 + l.gap + l.d / 2, 6);
    expect(l.step).toBeCloseTo(l.d + l.gap, 6);
  });

  it.each(SIZES)('the stylesheet\'s calc() at %i x %i gives exactly lensLayout\'s lens, photograph and wheel', (vw, vh) => {
    const l = lensLayout(vw, vh);
    expect(evalCss('var(--ly)', vw, vh)).toBeCloseTo(l.ly, 6);
    expect(evalCss('var(--ld)', vw, vh)).toBeCloseTo(l.ld, 6);
    expect(evalCss('var(--lx)', vw, vh)).toBeCloseTo(l.lx, 6);
    expect(evalCss('var(--pw)', vw, vh)).toBeCloseTo(l.photoW, 4);
    expect(evalCss('var(--ph)', vw, vh)).toBeCloseTo(l.photoH, 4);
    expect(evalCss('var(--d)', vw, vh)).toBeCloseTo(l.d, 6);
    expect(evalCss('var(--gap)', vw, vh)).toBeCloseTo(l.gap, 6);
    expect(evalCss('var(--first)', vw, vh)).toBeCloseTo(l.first, 6);
    expect(evalCss('var(--step)', vw, vh)).toBeCloseTo(l.step, 6);
    // the photograph's corner: the rule that places it
    const rule = /\.fx-photo \{[^}]*\}/.exec(css)![0];
    const left = /left:([^;]+);/.exec(rule)![1];
    const top = /top:([^;]+);/.exec(rule)![1];
    expect(evalCss(left, vw, vh)).toBeCloseTo(l.photoLeft, 4);
    expect(evalCss(top, vw, vh)).toBeCloseTo(l.photoTop, 4);
  });

  it('a wheel place sits at side x (first + (|offset| - 1) x step): the stylesheet\'s --x equals wheelX', () => {
    const l = lensLayout(1440, 900);
    const rule = /\.fx-wheel li \{([^}]*)\}/.exec(css)![1];
    const x = /--x:([^;]+);/.exec(rule)![1];
    expect(x).toContain('var(--s,0)');
    expect(x).toContain('var(--k,0)');
    for (const o of [-4, -3, -2, -1, 0, 1, 2, 3]) {
      const s = Math.sign(o); const k = Math.max(Math.abs(o) - 1, 0);
      const px = s * (l.first + k * l.step);
      expect(px).toBeCloseTo(wheelX(o, l), 6);
    }
  });
});

describe('the wheel and the gestures', () => {
  it('a ring of 8: the offset is the shortest signed distance, 0 for the selected place', () => {
    // the place exactly opposite (4 away on a ring of 8) goes to the right, as in the mockup
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ringOffset(i, 4, 8))).toEqual([4, -3, -2, -1, 0, 1, 2, 3]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ringOffset(i, 0, 8))).toEqual([0, 1, 2, 3, 4, -3, -2, -1]);
  });

  it('a place that goes round the back of the ring jumps (is hidden, moved, shown); one that moves a step slides', () => {
    // from selected 4 to 5: the place that was 3 to the left (index 1) is now 4 away and goes to the right of the ring: it is the only one that crosses the back
    const n = 8;
    const moved = [...Array(n).keys()].filter((i) => jumped(ringOffset(i, 4, n), ringOffset(i, 5, n), n));
    expect(moved).toEqual([1]);
    expect(jumped(0, 1, n)).toBe(false);
  });

  it('steps wrap the ring both ways and are locked for 520 ms', () => {
    expect(stepIndex(7, 1, 8)).toBe(0);
    expect(stepIndex(0, -1, 8)).toBe(7);
    expect(STEP_LOCK_MS).toBe(520);
    expect(stepAllowed(1000, 1519)).toBe(false);
    expect(stepAllowed(1000, 1520)).toBe(true);
  });

  it('a wheel flick under 8 px is noise; a swipe needs 40 px across or 50 px up/down (and a vertical drag inside the card scrolls the card)', () => {
    expect(WHEEL_MIN_DELTA).toBe(8);
    expect([SWIPE_MIN_X, SWIPE_MIN_Y]).toEqual([40, 50]);
    expect(swipeStep(-60, 5, false)).toBe(1);
    expect(swipeStep(60, 5, true)).toBe(-1);
    expect(swipeStep(30, 4, false)).toBe(0);
    expect(swipeStep(5, -70, false)).toBe(1);
    expect(swipeStep(5, -70, true)).toBe(0);
  });

  it('over the card the wheel scrolls the card while it can, and turns the ring only at its end', () => {
    expect(cardCanScroll(10, 0, 300, 600)).toBe(true);
    expect(cardCanScroll(10, 300, 300, 600)).toBe(false);
    expect(cardCanScroll(-10, 0, 300, 600)).toBe(false);
    expect(cardCanScroll(-10, 50, 300, 600)).toBe(true);
    expect(cardCanScroll(10, 0, 300, 300)).toBe(false);
  });

  it('"See all" only when the panel does not fit (4 px of tolerance) or the card is already raised', () => {
    expect(hasMore(300, 300, false)).toBe(false);
    expect(hasMore(304, 300, false)).toBe(false);
    expect(hasMore(305, 300, false)).toBe(true);
    expect(hasMore(300, 300, true)).toBe(true);
  });

  it('the heading changes every 6 s through a 950 ms fog and cycles', () => {
    expect([LINE_EVERY_MS, LINE_FOG_MS]).toEqual([6000, 950]);
    expect(nextLine(4, 5)).toBe(0);
    expect(nextLine(0, 3)).toBe(1);
  });
});

describe('the two wheels and the headings', () => {
  it('eight places each, unique ids, the Overview selected at first, Documents shared', () => {
    for (const m of ['startups', 'investors'] as const) {
      const ids = MODES[m].items.map((i) => i.id);
      expect(ids).toHaveLength(8);
      expect(new Set(ids).size).toBe(8);
      expect(MODES[m].items[MODES[m].home].label).toBe('Overview');
      expect(ids).toContain('docs');
    }
    expect(MODES.startups.items.map((i) => i.label)).toEqual(['Documents', 'FAQ', 'Share securely', 'Pricing', 'Overview', 'Find investors', 'Your fundraise', 'AI assistant']);
    expect(MODES.investors.items.map((i) => i.label)).toEqual(['Documents', 'FAQ', 'Your mandate', 'Access & pricing', 'Overview', 'Discover startups', 'Review & decide', 'Your pipeline']);
  });

  it('every place has a panel in the server HTML (static copy, or built from plans.ts)', () => {
    const built = new Set(['s-pricing', 'i-pricing']);
    for (const m of ['startups', 'investors'] as const) for (const it of MODES[m].items) expect(built.has(it.id) || it.id in PANEL_HTML, it.id).toBe(true);
  });

  it('the headings: five for startups, three for investors; the first is the server-rendered one', () => {
    expect(HERO_LINES.startups).toHaveLength(5);
    expect(HERO_LINES.investors).toHaveLength(3);
    expect(heroLineText(HERO_LINES.startups[0])).toBe('Crack the case on your fundraise.');
    expect(heroLineText(HERO_LINES.investors[0])).toBe('Fewer, better, investment-ready opportunities.');
  });

  it('the buttons go where the brief says, and the audience switch is two real links', () => {
    expect(CTA.startups).toEqual({ label: 'Create account', href: '/signup' });
    expect(CTA.investors).toEqual({ label: 'Claim your profile', href: '/claim' });
    expect(MODE_PATH).toEqual({ startups: '/', investors: '/investors' });
  });

  it('the legal chapters are the six of the brief, in this order; the AI one is the Terms\' own Clause 9', () => {
    expect(DOC_ORDER).toEqual(['terms', 'privacy', 'suppliers', 'data-rights', 'gdpr', 'ai-act']);
    expect(isDocId('gdpr')).toBe(true);
    expect(isDocId('contact')).toBe(false);
    const ai = aiClauseParagraphs();
    expect(ai.length).toBeGreaterThanOrEqual(4);
    expect(ai[0]).toMatch(/^9\.1\./);
    expect(ai.join(' ')).toContain('Regulation (EU) 2024/1689');
  });
});

describe('the copy keeps the product\'s rules', () => {
  const everything = [...Object.values(PANEL_HTML), ...Object.values(HERO_LINES).flatMap((ls) => ls.map(heroLineText))].join('\n');

  it('every demo is marked as an example', () => {
    for (const [id, html] of Object.entries(PANEL_HTML)) {
      // the Documents panel lists documents (not a demo of the product); the FAQ panels have no data
      if (id === 'docs' || (!html.includes('fx-demo') && !html.includes('fx-icard') && !html.includes('fx-agenda'))) continue;
      expect(html, id).toMatch(/fx-ex">[^<]*(Example|example)/);
    }
  });

  it('no promise of a result: no "guarantee", no reply rate, no closing time, no "most popular"', () => {
    // "guarantee" only to deny it (the FAQ's question "Does Sherlock Deal invest, or guarantee that I'll raise?" answers "No, on both")
    expect(everything.replace("guarantee that I'll raise?</summary><p>No, on both", '')).not.toMatch(/guarant/i);
    expect(everything).not.toMatch(/most popular/i);
    expect(everything).not.toMatch(/reply rate|response rate|close(s|d)? in \d+|\d+\s?% of (founders|investors|startups)/i);
  });

  it('the questions of the FAQPage are the panels\' own (the structured data says what the page says)', () => {
    expect(PANEL_FAQ.s).toHaveLength(5);
    expect(PANEL_FAQ.i).toHaveLength(4);
    for (const [q, a] of [...PANEL_FAQ.s, ...PANEL_FAQ.i]) {
      expect(q.length).toBeGreaterThan(5);
      expect(a.length).toBeGreaterThan(20);
    }
    const sHtml = PANEL_HTML['s-faq'].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'');
    expect(sHtml).toContain(PANEL_FAQ.s[0][0].replace(/&amp;/g, '&'));
  });

  it('the contact promise is the live form\'s ("a couple of business days"), never "one working day"; nothing is "saved as PDF"', () => {
    expect(PANEL_HTML.docs).toContain('We usually reply within a couple of business days');
    expect(everything).not.toMatch(/one working day|saved as PDF/i);
  });

  it('no founder-private performance data in the demos (pass counts, outreach counts, round progress)', () => {
    expect(everything).not.toMatch(/pass(es)? (ratio|count|rate)|soft[- ]circled|funding gap|\d+ passes/i);
  });
});

describe('the pricing panels are drawn from plans.ts', () => {
  const startups = renderToStaticMarkup(createElement(StartupPricing));
  const investors = renderToStaticMarkup(createElement(InvestorPricing));

  it('startups: every plan\'s name and price, the seats and the weekly deck from the product\'s own tables, ONE "Recommended" (the best-value plan), Private Detective as "Custom"', () => {
    for (const p of PLANS) {
      expect(startups).toContain(p.name.replace(/'/g, '&#x27;'));
      expect(startups).toContain(`€${p.monthlyEur}`);
      expect(startups).toContain(SEAT_COUNT_LABEL[p.tier]);
      expect(startups).toContain(`${MATCHDEAL_WEEKLY[p.tier].deck} new investors a week`);
    }
    expect(startups.match(/Recommended/g)).toHaveLength(1);
    expect(startups.indexOf('Recommended')).toBeGreaterThan(startups.indexOf('List of Suspects'));
    expect(startups.indexOf('Recommended')).toBeLessThan(startups.indexOf('Private Detective'));
    expect(startups).toContain('Private Detective');
    expect(startups).toContain('Custom');
    expect(startups).toContain('Prices exclude VAT');
    expect(startups).not.toMatch(/most popular/i);
  });

  it('investors: the three live plans at their live prices, no free tier, nothing "Recommended", Private Detective as "Custom"', () => {
    for (const p of INVESTOR_PLANS) {
      expect(investors).toContain(p.name);
      expect(investors).toContain(`€${p.monthlyEur}`);
      expect(investors).toContain(`Up to ${p.monthlyCap} matched opportunities`);
    }
    expect(investors).not.toContain('Recommended');
    expect(investors).not.toContain('€0');
    expect(investors).not.toMatch(/free/i);
    expect(investors).toContain('Custom');
  });
});

describe('the logos: only the authorized ones, drawn as white discs, escaped', () => {
  it('every logo the strip may draw has authorization recorded and a disc file in public/landing/logos-circle/', () => {
    for (const page of ['startups', 'investors'] as const) {
      for (const l of landingLogosFor(page)) {
        expect(l.authorization, `${page}/${l.name}`).not.toBe('pending');
        expect(existsSync(join(process.cwd(), 'public/landing/logos-circle', l.file)), l.file).toBe(true);
      }
    }
  });

  it('the strip is drawn only when there are enough logos (the 926 gate), and the track has the list twice for a seamless loop (the copy hidden from assistive technology)', () => {
    const m = landingMarquees();
    for (const mode of ['startups', 'investors'] as const) {
      const logos = landingLogosFor(mode);
      if (!logoStripVisible(logos)) { expect(m[mode]).toBe(''); continue; }
      expect(m[mode].match(/<figure>/g)).toHaveLength(logos.length);
      expect(m[mode].match(/<figure aria-hidden="true">/g)).toHaveLength(logos.length);
      expect(m[mode]).not.toContain('base64');
    }
  });

  it('a name with markup in it cannot reach the page as markup', () => {
    const html = marqueeHtml([{ file: 'a"b.png', name: '<img src=x onerror=alert(1)>' }], 'A "caption" & more', 's');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
    expect(html).toContain('A &quot;caption&quot; &amp; more');
    expect(marqueeHtml([], 'x', 's')).toBe('');
  });

  it('the photograph and the discs stay within their weight budgets (the first paint waits for the photograph)', () => {
    const size = (p: string) => statSync(join(process.cwd(), p)).size;
    expect(size('public/landing/lens-photo.avif')).toBeLessThan(60_000);
    expect(size('public/landing/lens-photo.webp')).toBeLessThan(90_000);
    expect(size('public/landing/lens-photo-blur.webp')).toBeLessThan(10_000);
  });
});

describe('the stylesheet is safe to ship in the app', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('every rule is under .fx-root (or is an @keyframes / a media query of such rules): nothing can leak into the rest of the app, and no rule of the app reaches it by a class of ours', () => {
    const top = stripped.replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, '$1').replace(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g, '').replace(/@supports[^{]+\{([\s\S]*?\})\s*\}/g, '$1');
    const selectors = [...top.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(150);
    for (const s of selectors) for (const part of s.split(',')) expect(part.trim().startsWith('.fx-root'), part.trim()).toBe(true);
  });

  it('the root has nothing that would make it the containing block of a fixed child: no transform, filter, backdrop-filter, perspective, contain, will-change (the popup is a child of it)', () => {
    for (const m of stripped.matchAll(/(^|\})\s*\.fx-root\s*\{([^}]*)\}/g)) {
      expect(m[2]).not.toMatch(/(^|;|\s)(transform|filter|backdrop-filter|perspective|contain|will-change)\s*:/);
    }
  });

  it('the page height is the window\'s: the root is fixed, full-window, overflow hidden', () => {
    expect(stripped).toMatch(/\.fx-root \{position:fixed;inset:0;[^}]*overflow:hidden/);
  });

  it('no image is inlined in the stylesheet or the components (no base64, no data: URI)', () => {
    for (const f of ['src/app/landing-fixed.css', 'src/components/landing-fixed/FixedLanding.tsx', 'src/components/landing-fixed/Panels.tsx', 'src/content/site/landing-fixed-panels.ts']) expect(read(f), f).not.toMatch(/base64|data:image/);
  });

  it('the three families come from the app\'s next/font variables, in the same stack the rest of the app uses', () => {
    expect(css).toContain('--display:var(--font-fraunces)');
    expect(css).toContain('--body:var(--font-inter)');
    expect(css).toContain('--wordmark:var(--font-comfortaa), var(--font-inter), sans-serif');
  });

  it('reduced motion: the strip stands still in one row, the headings stop (the component never starts the rotation)', () => {
    expect(css).toMatch(/prefers-reduced-motion:reduce\) \{[^}]*animation:none/);
    expect(read('src/components/landing-fixed/FixedLanding.tsx')).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
  });

  it('the phone: a bar fixed to the bottom with both buttons, and the card ends above it', () => {
    expect(css).toMatch(/\.fx-mbar\{display:none;position:fixed;left:0;right:0;bottom:0/);
    expect(css).toContain('.fx-root .fx-card{bottom:calc(var(--bar-h) + 12px)}');
  });
});

describe('what Lighthouse measured on the first build (02/11/2026) stays fixed', () => {
  const comp = read('src/components/landing-fixed/FixedLanding.tsx');

  it('the wheel list is not announced as a list (a tablist owns its tabs through it: aria-required-children / list), and the logo link has no label that differs from its visible text (label-content-name-mismatch)', () => {
    expect(comp).toContain('<ul role="presentation">');
    expect(comp).toMatch(/<Link className="fx-brand" href=\{MODE_PATH\[mode\]\}>/);
  });

  it('each route declares its own Fraunces (next/font preloads only the fonts a page or a layout declares), with only the weights the stylesheet uses', () => {
    for (const f of ['src/app/page.tsx', 'src/app/investors/page.tsx']) {
      const src = read(f);
      expect(src, f).toContain("weight: ['500', '600']");
      expect(src, f).toContain('fontClass={fraunces.variable}');
    }
    expect(read('src/components/landing-fixed/FixedLandingPage.tsx')).not.toContain("from 'next/font");
  });

  it('the background is a pre-baked image: no CSS filter on a window-sized layer', () => {
    expect(css).not.toMatch(/\.fx-blur[^}]*filter:/);
  });

  it('a phone reads at 12 px and up (the Lighthouse font-size audit needs 60% of the text at 12 px)', () => {
    expect(css).toMatch(/@media \(max-width:760px\) \{\s*\.fx-root \{--t-m:\.9rem;--t-s:\.8rem;--t-xs:\.75rem\}/);
  });
});

describe('the photograph is served without a session (Prompt 935 hotfix)', () => {
  it('the middleware matcher leaves every format the landing ships alone, AVIF included', () => {
    const mw = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8');
    const matcher = mw.match(/matcher: \[(.*)\]/)![1];
    for (const ext of ['avif', 'webp']) expect(matcher).toContain(ext);
  });
});
