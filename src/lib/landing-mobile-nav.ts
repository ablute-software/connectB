// Prompt 934 (02/11/2026, Nuno on a phone: "Sign in" and "Create account" were out of the screen) — the small pure rules behind the landing pages' phone/tablet header and its fixed bottom bar, kept out of the
// components so they are pinned without a browser (the components themselves only wire them to the DOM; the behaviour in a real browser is checked on the real pages).
//
// Up to 900 px wide the header cannot hold the links, the Startups/Investors selector and the two buttons (at 390 px they overflowed and were cut off by the page's `overflow-x: hidden`): it keeps the logo and
// a "Menu" button whose panel holds all of them, and a bar fixed to the bottom of the screen carries "Sign in" and "Create account" once the hero's own buttons are out of view.

/** The widest window that gets the Menu button and the bottom bar (the same line the hero uses to become one column). */
export const MOBILE_NAV_MAX_WIDTH = 900;

/** The header's height in px (landing.module.css: `.nav .wrap`): the hero's buttons count as out of view once they slide under it. */
export const NAV_HEIGHT = 72;

/** The attribute on the hero's row of buttons that the bottom bar watches (the "Start free" / "Claim your investor profile" row). */
export const HERO_CTAS_ATTR = 'data-hero-ctas';
export const HERO_CTAS_SELECTOR = `[${HERO_CTAS_ATTR}]`;

/** Set on <html> while the page carries the bar (it may be out of sight at that moment), so the end of the page can leave room for it (landing.module.css) and nothing else has to know. */
export const BAR_FLAG_ATTR = 'data-landing-bar';

/** The id the Menu button points at (aria-controls) and the panel carries. */
export const MENU_PANEL_ID = 'landing-menu-panel';

export interface MenuLink { readonly label: string; readonly href: string }

/**
 * Is the bar on screen? Only for a visitor who is not signed in (a signed-in visitor is sent into the product by the page itself; one who has no place there and sees the landing has no use for "Sign in"),
 * and only once the hero's own buttons are NOT on screen: while they are, the bar would say the same thing twice. `ctasOnScreen` is null until it has been measured (the server render and the first client
 * render), and then the bar is hidden, so what the server drew and what the browser draws first are the same.
 */
export function barVisible(ctasOnScreen: boolean | null, signedIn: boolean): boolean {
  return !signedIn && ctasOnScreen === false;
}

/** Is a click/tap at `target` outside the menu's button and its panel? (Then the panel closes.) */
export function isOutsideMenu(target: Node | null, button: Node | null, panel: Node | null): boolean {
  if (!target) return false;
  return !(button?.contains(target) || panel?.contains(target));
}

export const isCloseKey = (key: string): boolean => key === 'Escape';
