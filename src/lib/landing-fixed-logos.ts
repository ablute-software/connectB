// Prompt 935 — the logo strip of the fixed landing, as HTML. Pure (no React, no fs): a string builder, because the strip sits INSIDE a panel whose markup is a string (landing-fixed-panels.ts) and a server
// component cannot render JSX to a string. Every value that reaches the markup is escaped here.
import type { LandingLogo } from '@/lib/landing-logos';

/** Where a logo's white-disc version lives: public/landing/logos-circle/, same file name as the logo's own file (the strip draws 48 px discs; the files are 144 px, palette-compressed). */
export const logoCircleSrc = (l: Pick<LandingLogo, 'file'>): string => `/landing/logos-circle/${l.file}`;
/** The logo's own file (a transparent drawing), for the quiet monochrome strip under the headline. */
export const logoPlainSrc = (l: Pick<LandingLogo, 'file'>): string => `/landing/logos/${l.file}`;

export const logoCaption = (l: Pick<LandingLogo, 'name'>): string => l.name;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** One logo + its gap is at most this wide (the narrowest desktop figure (56 px) + its 20 px gap; the others are wider, so a half is never shorter than the strip of the widest layout). */
export const SLOT_PX = 76;
/** The widest strip the page can draw (a 4K window is 3840 px, the card is never wider than ~2200 px at that size). */
const WIDEST_STRIP_PX = 2200;

/** How many times the logos repeat in ONE half of the track: each half must be at least as wide as the widest strip, or the track runs out and leaves an empty stretch at its end (Nuno, 03/11/2026). */
export const marqueeRepeat = (count: number): number => Math.max(1, Math.ceil(WIDEST_STRIP_PX / (Math.max(1, count) * SLOT_PX)));

/**
 * The strip: a caption and the logos in two equal halves (everything after the first copy hidden from assistive technology), so the track can slide by half its width and loop with no seam. Each half repeats the
 * logos enough times to be wider than any strip, so the row never shows an end. Empty string when there is nothing to show: the caller decides that (stripVisible).
 */
export function marqueeHtml(logos: readonly Pick<LandingLogo, 'file' | 'name'>[], caption: string, kind: 's' | 'i', plain = false): string {
  if (logos.length === 0) return '';
  const fig = (l: Pick<LandingLogo, 'file' | 'name'>, visible: boolean) =>
    `<figure${visible ? '' : ' aria-hidden="true"'}><img src="${escapeHtml(plain ? logoPlainSrc(l) : logoCircleSrc(l))}" width="64" height="64" alt="${visible ? escapeHtml(l.name) : ''}" loading="${plain ? 'eager' : 'lazy'}" decoding="async"><figcaption>${escapeHtml(logoCaption(l))}</figcaption></figure>`;
  const copies = marqueeRepeat(logos.length) * 2;
  const track = Array.from({ length: copies }, (_, c) => logos.map((l) => fig(l, c === 0)).join('')).join('');
  // --cnt: the figures in one half of the track, so the stylesheet can give the turn the duration that makes a constant speed in px per second whatever the size of the logos
  return `<div class="fx-marquee fx-logos-${kind}"><div class="fx-cap">${escapeHtml(caption)}</div><div class="fx-strip"><div class="fx-track" style="--cnt:${logos.length * marqueeRepeat(logos.length)}">${track}</div></div></div>`;
}
