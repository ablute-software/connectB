// Prompt 926 (30/10/2026; carousel back and logos out of the hero 31/10/2026, Nuno) — the logos of the landing pages: the title above them, how fast they move, how big each is drawn, and the
// logos themselves (landing-logos.json, next to this file). Everything Nuno may want to tune is a constant here.
//
// The rules about WHICH logos may appear (authorization recorded, at least six) are in src/lib/landing-logos.ts, and README.md in public/landing/logos/ says how
// to add a logo and how to take one down.
import { BRAND_NAME } from '@/lib/brand';
import { logosForPage, parseLogos, stripVisible, type LandingLogo, type LogoPage, type LogoStripSizes } from '@/lib/landing-logos';
import data from './landing-logos.json';

/**
 * The title above the carousel, in the same light area, right over it. It must say that these are EXAMPLES and not the whole list (31/10/2026, Nuno: a fixed grid of logos "suggests that the
 * companies shown are all the organisations on the platform"). The startups page says that these startups are already on the platform; the investors page speaks of PROFILES of the database
 * (verified, active, none of them claimed by the firm yet) and gives the size of the database, never "investors on the platform": it must not suggest that they are all active users. The
 * "500+" is the figure the page itself gives in its section "Already in our database".
 */
export const LOGO_STRIP_LABEL: Record<LogoPage, string> = {
  startups: `Some of the startups already on ${BRAND_NAME}`,
  investors: 'A selection from 500+ investor profiles in our database',
};

/**
 * How fast the logos move, in CSS px per second, THE SAME on every screen: the stylesheet uses one duration for the desktop's list and another for the phone's (`loopSeconds` in
 * src/lib/landing-logos.ts), each worked out from the width of its own list. 32 px/s is the calm pace of the first strip (8 startup logos turn in 43 s on a laptop, 32 s on a phone).
 */
export const LOGO_STRIP_SPEED = 32;

/**
 * How big each logo is drawn. Every logo gets the same AREA, inside a widest and a tallest, and keeps the shape of its own file: a long wordmark is wide and low, a squarer mark is smaller
 * across and taller. The files are cropped to their drawing on a transparent background (no disc, no card): at 4600 px² a wordmark is 25-35 px tall and a mark up to 60 px.
 */
export const LOGO_STRIP_SIZES: LogoStripSizes = {
  desktop: { area: 4600, maxWidth: 170, maxHeight: 60, gap: 56 },
  phone: { area: 3000, maxWidth: 120, maxHeight: 46, gap: 36 },
};

/**
 * How far each end of the moving window fades into the page, in CSS px: the logos come in and go out through it, so none is ever cut by a hard edge. It was 72 / 32; a shorter fade starts nearer
 * the edge of the window (Nuno, 31/10/2026: more of the row is seen, less is lost to the fade). It plays no part in the rule that no logo shows twice at once (landing-logos.ts: `noRepeatWindow`
 * counts every pixel of a logo, faded or not).
 */
export const LOGO_STRIP_FADE = { desktop: 48, phone: 20 } as const;

export const LANDING_LOGOS: readonly LandingLogo[] = parseLogos(data);

/** The logos a page may draw today (authorized and meant for it). The page draws the strip only when there are enough: see `logoStripVisible`. */
export const landingLogosFor = (page: LogoPage, today?: Date): LandingLogo[] => logosForPage(page, LANDING_LOGOS, today);

export const logoStripVisible = (logos: readonly LandingLogo[]): boolean => stripVisible(logos);
