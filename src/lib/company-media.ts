// Prompt 353 — pure logic for the company Photos & media gallery. No I/O
// here — the allowlist/embed-URL functions are the audit surface for "which
// external links are we willing to render an iframe from," kept testable
// without a DOM or network.
export type MediaCategory = 'company' | 'technology' | 'team';
export type MediaKind = 'image' | 'video_upload' | 'video_link';

export const MEDIA_CATEGORIES: { value: MediaCategory; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'technology', label: 'Technology / IP' },
  { value: 'team', label: 'Team' },
];

export const CAPTION_MAX_LEN = 140;
// Decision, documented per the prompt's own "decide e documenta": a cap of
// 20 items per org is generous enough for a real gallery (a handful of
// office/product/team shots plus a couple of demo videos) without an
// unbounded upload surface next to the Vault's own document limits.
export const MAX_MEDIA_PER_ORG = 20;
// 25MB for an image is already generous; a "short video" cap of 100MB is
// enough for a 1-2 minute clip at reasonable compression without inviting
// someone to upload a feature-length file to Supabase Storage.
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

// Prompt 353 — strict allowlist: YouTube and Vimeo only, validated by
// hostname (never a substring match — "youtube.com.evil.example" must not
// pass). No embeds from anywhere else, ever.
const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
]);

export function isAllowedVideoLink(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_VIDEO_HOSTS.has(parsed.hostname.toLowerCase());
}

// Extracts the platform's own video id and returns a clean, minimal embed
// URL — never the raw pasted URL rendered directly into an iframe src
// (which could carry query params/fragments not meant for embedding).
// Returns null for a link that passed the host check but doesn't parse into
// a recognizable single-video URL shape (e.g. a channel or playlist link) —
// callers must treat that as "can't embed this," never fall back to
// rendering the raw URL.
export function toEmbedUrl(rawUrl: string): string | null {
  if (!isAllowedVideoLink(rawUrl)) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host.endsWith('youtube.com')) {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (parsed.pathname.startsWith('/embed/')) return `https://www.youtube.com${parsed.pathname}`;
    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.split('/')[2];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  }
  if (host.endsWith('vimeo.com')) {
    if (host === 'player.vimeo.com' && parsed.pathname.startsWith('/video/')) return `https://player.vimeo.com${parsed.pathname}`;
    const id = parsed.pathname.replace(/^\//, '').split('/')[0];
    return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

export interface CompanyMediaDraft { category: MediaCategory; caption: string }

export function validateCaption(caption: string): string | null {
  const trimmed = caption.trim();
  if (!trimmed) return 'A caption is required.';
  if (trimmed.length > CAPTION_MAX_LEN) return `Caption is too long (max ${CAPTION_MAX_LEN} characters).`;
  return null;
}
