'use client';
// Prompt 676 §2 — the small colored-circle-with-initials (real logo when one
// can be found) avatar, for wherever an investor's name appears without one
// today: the Pipeline list and the dossier panel header.
//
// The initials/hash-color technique already existed in this codebase, just
// never exported: MatchDealDeck.tsx's own private `initialsOf`/`hashString`/
// `GRADIENTS` (a founder-card art treatment). Reused here rather than
// reinvented, per Prompt 676's own instruction to reuse an existing pattern
// — this file is that pattern, pulled out so BOTH call sites can share it
// instead of a third private copy.
//
// No `entities.logo_url` column exists (the only `logo_url` in the schema
// belongs to `orgs` — the founder's own uploaded logo, a private Storage
// path, unrelated). Nuno's own suggestion, confirmed against a real column
// that IS populated for most investors: derive a favicon from `website` via
// a public, no-auth service, and fall back to the initials circle — on a
// missing website, OR on the image actually failing to load (this
// component's one addition beyond the prior art: an `onError` handler, since
// none of the existing internal copies had one — "no website" and "website
// present but the favicon 404s" both need to reach the same fallback).
import { useState } from 'react';

const PALETTE: readonly { bg: string; fg: string }[] = [
  { bg: '#E6F5FA', fg: '#0E7490' }, // teal (brand)
  { bg: '#E6F6ED', fg: '#158049' }, // green
  { bg: '#E9F2FD', fg: '#1D6FD4' }, // blue
  { bg: '#FDF3E6', fg: '#B4670C' }, // amber
  { bg: '#FDECF1', fg: '#B81A49' }, // rose
  { bg: '#F0E9FD', fg: '#7C3AED' }, // purple
  { bg: '#EEF3F6', fg: '#5D7280' }, // slate
  { bg: '#FDE9E0', fg: '#C2410C' }, // orange
];

/** A plain string hash (Java's String.hashCode algorithm) — deterministic, no crypto needed for a palette index. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Same seed (an entity's id, the stable choice — see EntityAvatar below) always lands on the same palette entry, everywhere it's used. */
export function avatarColors(seed: string): { bg: string; fg: string } {
  if (!seed) return PALETTE[0];
  return PALETTE[hashString(seed) % PALETTE.length];
}

/** First letter of the first two real words; a single word gives its own first two letters; nothing usable gives "?". Punctuation (the underscores/em-dashes common in this app's fixture and firm names) is treated as a separator, not a letter. */
export function avatarInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function faviconUrl(website: string): string | null {
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

const SIZE_PX: Record<'sm' | 'md', number> = { sm: 24, md: 32 };

export function EntityAvatar({ id, name, website, size = 'sm' }: {
  /** The hash seed — an id, not the display name, so a rename never reshuffles every avatar's color at once. */
  id: string;
  name: string;
  website?: string | null;
  size?: 'sm' | 'md';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = !imgFailed && website ? faviconUrl(website) : null;
  const px = SIZE_PX[size];
  const { bg, fg } = avatarColors(id);

  if (src) {
    return (
      <img src={src} alt="" width={px} height={px}
        className="shrink-0 rounded-full bg-gray-100 object-cover"
        style={{ width: px, height: px }}
        onError={() => setImgFailed(true)} />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: px, height: px, background: bg, color: fg, fontSize: px * 0.4 }}
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </span>
  );
}
