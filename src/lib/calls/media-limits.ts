// Prompt 918 (Adenda 1, C) — what the cover image and the logo accept, in ONE place that both sides may import: the General step (the browser says "too large" or "not a PNG, JPG or WebP" before
// anything is sent) and the server (src/lib/calls/branding.ts, which checks the bytes). No server-only code here: a client component must be able to import this.
export const MEDIA_KINDS = ['cover', 'logo'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const isMediaKind = (v: unknown): v is MediaKind => MEDIA_KINDS.includes(v as MediaKind);
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
export const MEDIA_REFUSED_FORMAT = 'Use a PNG, JPG or WebP image. SVG and GIF files are not accepted.';
