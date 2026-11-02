// Prompt 934 (02/11/2026) — what the two components put in the page, read from the server-rendered markup (the stylesheet is a CSS module; under test its class names are their own names). What they DO in a browser —
// the bar coming in once the hero's buttons leave the screen, the Menu opening and closing — is measured on the real pages (docs/screenshots-934/); the rules behind it are in src/lib/landing-mobile-nav.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/landing.module.css', () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }));

import { LandingMenu } from './LandingMenu';
import { LandingMobileBar } from './LandingMobileBar';

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const STARTUP_LINKS = [{ label: 'Features', href: '#features' }, { label: 'How it works', href: '#how' }, { label: 'Pricing', href: '#pricing' }];

describe('LandingMobileBar', () => {
  const bar = (props: Partial<Parameters<typeof LandingMobileBar>[0]> = {}) => renderToStaticMarkup(createElement(LandingMobileBar, { signedIn: false, signInHref: '/login', createHref: '/signup', ...props }));

  it('a signed-in visitor gets nothing at all', () => {
    expect(bar({ signedIn: true })).toBe('');
  });

  it('the server draws it HIDDEN (data-visible="false"): the first client render is the same, so nothing flashes or mismatches; it is a labelled group with exactly two links', () => {
    const html = bar();
    expect(html).toContain('class="mobileBar"');
    expect(html).toContain('data-visible="false"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Sign in or create an account"');
    expect(count(html, /<a\b/g)).toBe(2);
    expect(html).not.toContain('aria-hidden'); // out of sight it is hidden by CSS (visibility), which also takes it out of the tab order
  });

  it('"Sign in" is the ghost button and "Create account" the gold one, in that order, to the hrefs it was given (the startups\' and the investors\')', () => {
    const s = bar();
    expect(s).toMatch(/<a class="btn btnGhost" href="\/login">Sign in<\/a><a class="btn btnPrimary" href="\/signup">Create account<\/a>/);
    const i = bar({ signInHref: '/login?as=investor', createHref: '/claim' });
    expect(i).toMatch(/<a class="btn btnGhost" href="\/login\?as=investor">Sign in<\/a><a class="btn btnPrimary" href="\/claim">Create account<\/a>/);
  });
});

describe('LandingMenu', () => {
  const menu = (children?: string) => renderToStaticMarkup(createElement(LandingMenu, { links: STARTUP_LINKS, signInHref: '/login', createHref: '/signup' }, children ? createElement('div', { 'data-selector': '' }, children) : undefined));

  it('the button says "Menu", has an icon, is closed (aria-expanded="false") and points at the panel (aria-controls = the panel\'s id)', () => {
    const html = menu('selector');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*class="menuBtn"[^>]*aria-expanded="false"[^>]*aria-controls="landing-menu-panel"/);
    expect(html).toContain('<svg');
    expect(html).toContain('<span>Menu</span>');
    expect(html).toContain('id="landing-menu-panel"');
    expect(html).toContain('class="menuPanel" data-open="false"');
  });

  it('the panel holds the page\'s links, then the selector, then "Sign in" and "Create account" — in that order', () => {
    const html = menu('SELECTOR-HERE');
    const at = (s: string) => html.indexOf(s);
    expect(at('Features')).toBeGreaterThan(-1);
    expect(at('Features')).toBeLessThan(at('How it works'));
    expect(at('How it works')).toBeLessThan(at('Pricing'));
    expect(at('Pricing')).toBeLessThan(at('SELECTOR-HERE'));
    expect(at('SELECTOR-HERE')).toBeLessThan(at('>Sign in<'));
    expect(at('>Sign in<')).toBeLessThan(at('>Create account<'));
    for (const l of STARTUP_LINKS) expect(html).toContain(`<a class="menuLink" href="${l.href}">${l.label}</a>`);
    expect(html).toContain('<a class="btn btnGhost" href="/login">Sign in</a>');
    expect(html).toContain('<a class="btn btnPrimary" href="/signup">Create account</a>');
  });

  it('without a selector the panel has no empty block for it', () => {
    expect(menu()).not.toContain('menuAudience');
    expect(menu('x')).toContain('class="menuAudience"');
  });
});
