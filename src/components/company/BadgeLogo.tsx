'use client';
// Prompt 918 C.4 / D — the square a badge's logo lives in. `src` is always one of OUR routes (never a Storage URL, never a third party's
// address); when there is none, or the route answers "not found", or the image fails to load, the icon for the badge's kind takes its
// place — never initials. The same component draws the founder's card and the investor's block, so they cannot drift apart.
import { useState } from 'react';
import type { BadgeKind } from '@/lib/company-badges';
import { BadgeKindIcon } from './BadgeKindIcon';

export function BadgeLogo({ src, kind, className = 'h-12 w-12' }: { src: string | null | undefined; kind: BadgeKind; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white ${className}`}
      data-badge-logo={showImage ? 'image' : 'icon'}>
      {showImage
        // eslint-disable-next-line @next/next/no-img-element -- the bytes come from our own route; next/image would proxy them a second time
        ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
        : <BadgeKindIcon kind={kind} className="h-1/2 w-1/2 text-gray-400" />}
    </span>
  );
}
