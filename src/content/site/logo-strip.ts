// Prompt 926 (30/10/2026) — the strip of logos at the foot of the landing's hero: the words above it, the speed it turns at, the size the logos are drawn at, and the
// logos themselves (landing-logos.json, next to this file). Everything Nuno may want to tune is a constant here.
//
// The rules about WHICH logos may appear (authorization recorded, at least six) are in src/lib/landing-logos.ts, and README.md in public/landing/logos/ says how
// to add a logo and how to take one down.
import { BRAND_NAME } from '@/lib/brand';
import { logosForPage, parseLogos, stripVisible, type LandingLogo, type LogoPage, type LogoStripSizes } from '@/lib/landing-logos';
import data from './landing-logos.json';

/**
 * The line above the logos: small, centred, fixed (it does not move with the logos), in the brand's amber. The startups page shows the startups that trust the platform
 * ("Startups que confiam em nós", Nuno, 30/10/2026; the site is in English); the investors page shows investors of the catalogue instead and says so (Nuno, 31/10/2026:
 * "Examples of investors already on Sherlock Deal"; the page's own section below it, "Already in our database", is about the same profiles).
 */
export const LOGO_STRIP_LABEL: Record<LogoPage, string> = {
  startups: 'Startups that trust us',
  investors: `Examples of investors already on ${BRAND_NAME}`,
};

/**
 * How fast the logos move, in CSS px per second: the calm pace of the first strip (8 logos of 96 px with a 64 px gap turn in 40 s, which the brief asked for: 30 to 45 s).
 * A longer list takes longer to turn but moves at the same speed (see `loopSeconds` in src/lib/landing-logos.ts).
 */
export const LOGO_STRIP_SPEED = 32;

/**
 * The size of one logo's box, in CSS px. The files are 512 px (startups) and 320 px (investors) discs: a white circle with the name inside it, 14% to 48% of the
 * circle's height, so the box is the disc: at the 32-40 px of the brief a name would be 5 to 13 px tall. A logo cropped without margins would go back to 32-40 px (phone 24-28).
 * 30/10/2026, Nuno: "aumenta os logos e a altura da barra" — 64 px became 96 px (phone 44 became 68), and the gap grew with them.
 */
export const LOGO_STRIP_SIZES: LogoStripSizes = { height: 96, gap: 64, maxWidth: 200, heightPhone: 68, gapPhone: 36, maxWidthPhone: 140 };

export const LANDING_LOGOS: readonly LandingLogo[] = parseLogos(data);

/** The logos a page may draw today (authorized and meant for it). The page draws the strip only when there are enough: see `logoStripVisible`. */
export const landingLogosFor = (page: LogoPage, today?: Date): LandingLogo[] => logosForPage(page, LANDING_LOGOS, today);

export const logoStripVisible = (logos: readonly LandingLogo[]): boolean => stripVisible(logos);
