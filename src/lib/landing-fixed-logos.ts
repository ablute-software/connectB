// Prompt 935 — the logo strip of the fixed landing, as HTML. Pure (no React, no fs): a string builder, because the strip sits INSIDE a panel whose markup is a string (landing-fixed-panels.ts) and a server
// component cannot render JSX to a string. Every value that reaches the markup is escaped here.
import type { LandingLogo } from '@/lib/landing-logos';

/** Where a logo's white-disc version lives: public/landing/logos-circle/, same file name as the logo's own file (the strip draws 48 px discs; the files are 144 px, palette-compressed). */
export const logoCircleSrc = (l: Pick<LandingLogo, 'file'>): string => `/landing/logos-circle/${l.file}`;

export const logoCaption = (l: Pick<LandingLogo, 'name'>): string => l.name;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * The strip: a caption and the logos twice in a row (the second copy hidden from assistive technology), so the track can slide by half its width and loop with no seam. Empty string when there is
 * nothing to show: the caller decides that (stripVisible).
 */
export function marqueeHtml(logos: readonly Pick<LandingLogo, 'file' | 'name'>[], caption: string, kind: 's' | 'i'): string {
  if (logos.length === 0) return '';
  const fig = (l: Pick<LandingLogo, 'file' | 'name'>, copy: 0 | 1) =>
    `<figure${copy === 1 ? ' aria-hidden="true"' : ''}><img src="${escapeHtml(logoCircleSrc(l))}" width="64" height="64" alt="${copy === 0 ? escapeHtml(l.name) : ''}" loading="lazy" decoding="async"><figcaption>${escapeHtml(logoCaption(l))}</figcaption></figure>`;
  const track = logos.map((l) => fig(l, 0)).join('') + logos.map((l) => fig(l, 1)).join('');
  return `<div class="fx-marquee fx-logos-${kind}"><div class="fx-cap">${escapeHtml(caption)}</div><div class="fx-strip"><div class="fx-track">${track}</div></div></div>`;
}
