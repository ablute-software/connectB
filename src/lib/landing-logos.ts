// Prompt 926 (30/10/2026) — which company logos the landing's strip may show, and when the strip shows at all.
//
// A company's logo on the public landing says, in public, that it uses Sherlock Deal. So a logo is shown only when its authorization is RECORDED in
// src/content/site/landing-logos.json: a date and a form (an email from the company, the terms it accepted, or the owner's own decision). Getting the authorization is Nuno's job,
// outside the code. Anything short of a complete record is "not authorized" — the word "pending", a missing field, a date that does not exist, a date in
// the future — and a logo that is not authorized is never drawn: the rule fails closed, it cannot be satisfied by accident.
//
// The strip also needs LOGO_STRIP_MIN authorized logos for the page. A strip with two or three names reads as a short list of customers, not as proof, so
// below the minimum it is not drawn at all (and the page keeps its old spacing).
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
  authorization: 'pending' | LogoAuthorization;
}

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
    return [{ name: o.name, file: o.file, width: o.width, height: o.height, pages: o.pages as LogoPages, order: o.order, authorization: o.authorization as LandingLogo['authorization'] }];
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

/** The sizes the strip draws at, in CSS px. They reach the stylesheet as custom properties (see LogoStrip), so the CSS never repeats them. */
export interface LogoStripSizes {
  height: number; gap: number; maxWidth: number;
  heightPhone: number; gapPhone: number; maxWidthPhone: number;
}

/** The widest the moving window can be: the page's content width (1140) less its two 24 px paddings, rounded up. */
export const LOGO_STRIP_WINDOW = 1100;

/** How wide a logo is drawn: the box's height times the file's own shape, never wider than `maxWidth` (a long logo is shrunk to fit, not stretched taller). */
export function drawnWidth(logo: Pick<LandingLogo, 'width' | 'height'>, height: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.round((height * logo.width) / logo.height));
}

/**
 * How many copies of the list the track needs for the loop never to show an empty end. The track slides left by exactly one copy and starts over, so what is on
 * screen at any moment is [offset, offset + window] inside K copies: (K - 1) copies must cover the widest window. The narrowest list (phone sizes) is the case
 * that needs the most copies, so it is the one counted.
 */
export function loopCopies(logos: readonly Pick<LandingLogo, 'width' | 'height'>[], sizes: LogoStripSizes): number {
  const listWidth = (height: number, gap: number, maxWidth: number) => logos.reduce((sum, l) => sum + drawnWidth(l, height, maxWidth) + gap, 0);
  const narrowest = Math.min(listWidth(sizes.height, sizes.gap, sizes.maxWidth), listWidth(sizes.heightPhone, sizes.gapPhone, sizes.maxWidthPhone));
  return Math.max(2, Math.ceil(LOGO_STRIP_WINDOW / narrowest) + 1);
}
