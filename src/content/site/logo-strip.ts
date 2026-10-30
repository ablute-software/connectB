// Prompt 926 (30/10/2026) — the strip of logos under the landing's hero: the words above it, the speed it turns at, the size the logos are drawn at, and the
// logos themselves (landing-logos.json, next to this file). Everything Nuno may want to tune is a constant here.
//
// The rules about WHICH logos may appear (authorization recorded, at least six) are in src/lib/landing-logos.ts, and README.md in public/landing/logos/ says how
// to add a logo and how to take one down.
import { BRAND_NAME } from '@/lib/brand';
import { logosForPage, parseLogos, stripVisible, type LandingLogo, type LogoPage, type LogoStripSizes } from '@/lib/landing-logos';
import data from './landing-logos.json';

/** The small grey line next to the logos (above them on a phone), one per page. */
export const LOGO_STRIP_LABEL: Record<LogoPage, string> = {
  startups: `Startups and investors already on ${BRAND_NAME}`,
  investors: `Startups already on ${BRAND_NAME}`,
};

/** One full turn of the list, in seconds: the brief asks for 30 to 45 (a calm pace); a longer list turns in the same time, so it moves faster. */
export const LOGO_STRIP_LOOP_SECONDS = 40;

/**
 * The size of one logo's box, in CSS px. The files delivered so far are 512 px discs (a white circle with the name small inside it, 14% to 48% of the circle's height),
 * so the box is the disc: at the 32-40 px of the brief a name would be 5 to 13 px tall. A logo cropped without margins would go back to 32-40 px (phone 24-28).
 */
export const LOGO_STRIP_SIZES: LogoStripSizes = { height: 64, gap: 56, maxWidth: 150, heightPhone: 44, gapPhone: 32, maxWidthPhone: 110 };

export const LANDING_LOGOS: readonly LandingLogo[] = parseLogos(data);

/** The logos a page may draw today (authorized and meant for it). The page draws the strip only when there are enough: see `logoStripVisible`. */
export const landingLogosFor = (page: LogoPage, today?: Date): LandingLogo[] => logosForPage(page, LANDING_LOGOS, today);

export const logoStripVisible = (logos: readonly LandingLogo[]): boolean => stripVisible(logos);
