// Prompt 926 (30/10/2026) — which company logos the landing's strip may show, and when the strip shows at all.
//
// A company's logo on the public landing says, in public, that it uses Sherlock Deal. So a logo is shown only when its authorization is RECORDED in
// src/content/site/landing-logos.json: a date and a form (an email from the company, the terms it accepted, or the owner's own decision). Getting the authorization is Nuno's job,
// outside the code. Anything short of a complete record is "not authorized" — the word "pending", a missing field, a date that does not exist, a date in
// the future — and a logo that is not authorized is never drawn: the rule fails closed, it cannot be satisfied by accident.
//
// The strip also needs LOGO_STRIP_MIN authorized logos for the page. A strip with two or three names reads as a short list of customers, not as proof, so
// below the minimum it is not drawn at all (and the page goes from the hero straight to the next section).
//
// scripts/check-landing-logos.mjs states the same two rules for `npm run build`, which warns about every logo it hides; landing-logos.test.ts runs both
// through the same cases so they cannot drift apart.

/** Fewest authorized logos for a page before the strip appears (Prompt 926 §C.3). */
export const LOGO_STRIP_MIN = 6;

export type LogoPage = 'startups' | 'investors';
export const LOGO_PAGES = ['startups', 'investors', 'both'] as const;
export type LogoPages = (typeof LOGO_PAGES)[number];

// 'owner' (30/10/2026): the platform owner's own decision, with no proof from the company on file. It is recorded as exactly that, never as an email or terms that do not exist;
// the build prints a line for every logo shown this way, and an email or accepted terms replace it when they exist.
export const AUTHORIZATION_FORMS = ['email', 'terms', 'owner'] as const;
export type AuthorizationForm = (typeof AUTHORIZATION_FORMS)[number];

export interface LogoAuthorization {
  /** The day the company gave its authorization, yyyy-mm-dd. */
  date: string;
  /** How it was given: an email from the company, the terms it accepted, or "owner": the platform owner's decision, with no proof from the company on file. */
  form: AuthorizationForm;
  /** Where the proof is kept (a mailbox label, a thread subject). Never an address or any personal data: the file lives in the repository. */
  note?: string;
}

export interface LandingLogo {
  /** The company's name: it is the image's alternative text. */
  name: string;
  /** The file inside public/landing/logos/. */
  file: string;
  /** The file's own size in pixels (an SVG: its viewBox). It is written on the <img> so the space is reserved before the file arrives. */
  width: number;
  height: number;
  pages: LogoPages;
  /** Position in the strip, ascending; a tie falls back to the name. */
  order: number;
  /**
   * Optical weight (Nuno, 31/10/2026: "some logos need a slight increase, others a slight reduction"): a multiplier on the AREA the logo is drawn at, 1 when absent. A solid block or a heavy mark
   * (a filled rectangle, a black disc) weighs more to the eye than a thin wordmark of the same area, so it gets under 1 and the thin one over 1. The logo keeps the shape of its own file.
   */
  weight?: number;
  authorization: 'pending' | LogoAuthorization;
}

/** The range `weight` may take: an optical nudge, never a different size. The build script (scripts/check-landing-logos.mjs) states the same range. */
export const LOGO_WEIGHT_MIN = 0.5;
export const LOGO_WEIGHT_MAX = 1.6;
export const isValidLogoWeight = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= LOGO_WEIGHT_MIN && v <= LOGO_WEIGHT_MAX;

export const LOGO_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(svg|png|webp)$/i;

/** A yyyy-mm-dd that exists on the calendar (2026-02-30 does not). */
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Why an authorization does not count, or null when it does. The words are the ones `npm run build` prints. */
export function authorizationProblem(authorization: unknown, today: Date = new Date()): string | null {
  if (authorization === 'pending') return 'authorization pending';
  if (typeof authorization !== 'object' || authorization === null) return 'no authorization recorded';
  const { date, form } = authorization as Record<string, unknown>;
  if (!isRealIsoDate(date)) return 'authorization date missing or not a real yyyy-mm-dd date';
  if (date > today.toISOString().slice(0, 10)) return 'authorization date is in the future';
  if (!(AUTHORIZATION_FORMS as readonly unknown[]).includes(form)) return `authorization form missing or not one of: ${AUTHORIZATION_FORMS.join(', ')}`;
  return null;
}

export function isAuthorized(logo: Pick<LandingLogo, 'authorization'>, today?: Date): boolean {
  return authorizationProblem(logo.authorization, today) === null;
}

/** What the file may contain; a row that is not shaped like this is dropped (and `npm run build` says so), never rendered. */
export function parseLogos(raw: unknown): LandingLogo[] {
  if (!Array.isArray(raw)) return [];
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  return raw.flatMap((r): LandingLogo[] => {
    if (typeof r !== 'object' || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.name !== 'string' || o.name.trim() === '') return [];
    if (typeof o.file !== 'string' || !LOGO_FILE_PATTERN.test(o.file)) return [];
    if (!positive(o.width) || !positive(o.height)) return [];
    if (!(LOGO_PAGES as readonly unknown[]).includes(o.pages)) return [];
    if (typeof o.order !== 'number' || !Number.isFinite(o.order)) return [];
    if (o.weight !== undefined && !isValidLogoWeight(o.weight)) return [];
    return [{
      name: o.name, file: o.file, width: o.width, height: o.height, pages: o.pages as LogoPages, order: o.order,
      ...(o.weight === undefined ? {} : { weight: o.weight as number }),
      authorization: o.authorization as LandingLogo['authorization'],
    }];
  });
}

/** The logos one page may show: authorized, meant for that page, in the order the file gives them. */
export function logosForPage(page: LogoPage, all: readonly LandingLogo[], today?: Date): LandingLogo[] {
  return all
    .filter((l) => (l.pages === 'both' || l.pages === page) && isAuthorized(l, today))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function stripVisible(logos: readonly unknown[]): boolean {
  return logos.length >= LOGO_STRIP_MIN;
}

/** What one layout draws the logos at, in CSS px. */
export interface LogoSizing {
  /** The AREA every logo gets (px²): a long, thin wordmark and a squarer mark weigh the same to the eye. */
  area: number;
  /** The widest and the tallest a logo may be: a very long or very tall one is held to them and keeps its shape. */
  maxWidth: number;
  maxHeight: number;
  /** The space between two logos (and the closing space of each copy of the list, so the seam is the same as any other gap). */
  gap: number;
}

/** The two layouts of the strip: the desktop's and the phone's (the stylesheet switches at 760 px). They reach the stylesheet as custom properties (see LogoStrip), so the CSS never repeats them. */
export interface LogoStripSizes { desktop: LogoSizing; phone: LogoSizing }

/** The viewport width up to which the stylesheet uses the phone's layout (landing.module.css: max-width 760px). */
export const LOGO_STRIP_PHONE_MAX = 760;

type Shaped = Pick<LandingLogo, 'width' | 'height' | 'weight'>;

export interface LogoBox { width: number; height: number }

/**
 * The box each logo is drawn in, so that no logo dominates the row: every logo gets the SAME AREA (equal heights would make the long wordmarks huge, equal widths would shrink
 * the squarer marks) times its own optical `weight` (1 when it has none), kept inside `maxWidth` x `maxHeight`, and each logo keeps the shape of its own file. Sizes are rounded to a tenth of a pixel.
 */
export function logoBoxes(logos: readonly Shaped[], s: Pick<LogoSizing, 'area' | 'maxWidth' | 'maxHeight'>): LogoBox[] {
  return logos.map((l) => {
    const ar = l.width / l.height;
    let width = Math.sqrt(s.area * (l.weight ?? 1) * ar);
    let height = width / ar;
    if (width > s.maxWidth) { width = s.maxWidth; height = width / ar; }
    if (height > s.maxHeight) { height = s.maxHeight; width = height * ar; }
    return { width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
  });
}

/** The width of one copy of the list at one layout: every logo's width plus one gap after it (the gap that also closes the copy). */
export function listWidth(logos: readonly Shaped[], s: LogoSizing): number {
  return logoBoxes(logos, s).reduce((sum, b) => sum + b.width + s.gap, 0);
}

/**
 * The widest the moving window can be at one layout (CSS px) so that NO logo is ever visible twice at once (Nuno, 31/10/2026: with eight startups the same brand showed at both ends of a wide window).
 * One copy of the list is `listWidth` long and the copies sit exactly that far apart, so a logo of width w at x and its copy at x + C are both inside a window of width W when W > C - w
 * (the right end of the first is still in view while the left end of the second has already come in). The widest logo is the first to do it, so the window may be at most C - widest: not one pixel
 * of any logo is shown twice, fades or not. It comes from the real sizes, so it is not a number to maintain: with more logos (a longer list) the window widens by itself, and with fewer it narrows.
 * Rounded down to a whole pixel, which is what the stylesheet's max-width takes.
 */
export function noRepeatWindow(logos: readonly Shaped[], s: LogoSizing): number {
  const boxes = logoBoxes(logos, s);
  if (boxes.length === 0) return 0;
  return Math.floor(listWidth(logos, s) - Math.max(...boxes.map((b) => b.width)));
}

/** The window each layout may have: the desktop's applies above 760 px of viewport, the phone's up to it. The window is the viewport's width up to this, then centred. */
export function logoWindows(logos: readonly Shaped[], sizes: LogoStripSizes): { desktop: number; phone: number } {
  return { desktop: noRepeatWindow(logos, sizes.desktop), phone: noRepeatWindow(logos, sizes.phone) };
}

/**
 * Copies of the list the track holds. It slides left by exactly one copy and starts over, so what is on screen is [offset, offset + window] inside the copies, with offset below one list:
 * two copies cover it as long as the window is shorter than one list, which `noRepeatWindow` guarantees (it is the list minus the widest logo). The second copy is the same logos again, only for
 * the movement to be seamless: it is hidden from assistive technology.
 */
export const LOOP_COPIES = 2;

/**
 * Seconds one full turn of the list takes AT ONE LAYOUT, so that the logos move at the same speed in CSS px per second whatever the screen and whatever the length of the list.
 * The stylesheet uses one duration for the desktop's list and another for the phone's, because the phone's logos are smaller and its list shorter: with one duration for both,
 * the phone would crawl.
 */
export function loopSeconds(logos: readonly Shaped[], s: LogoSizing, pxPerSecond: number): number {
  return Math.max(1, Math.round(listWidth(logos, s) / pxPerSecond));
}
