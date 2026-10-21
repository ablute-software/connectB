'use client';
// Prompt 918 (Adenda 2, A) — the pictures of a call's entry page, and what is shown when one cannot be loaded. A picture that fails must never leave a broken-image icon or its alternative text
// spread over the page (the 20/10/2026 INNOV-ID page showed "ablute_ — Internal" in three lines where the logo had been): without a cover the band in the platform's colour stays; without a logo
// — none uploaded, or one that does not load — the entity's initials stand in a square. The pictures are decorative (the entity's name is always written beside them), so their alt text is empty.
import { useEffect, useRef, useState } from 'react';
import { initialsOf } from '@/lib/calls/initials';

/**
 * Whether the picture failed: an error event, or — for one that failed before this component was hydrated, when no event reaches React — an image the browser has finished with and
 * found empty. Starts false, so the server render and the first client render agree.
 */
export function useImageFailed(url: string | null | undefined) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setFailed(false);
    const el = ref.current;
    if (url && el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [url]);
  return { failed, ref, onError: () => setFailed(true) };
}

/** The entity's initials in a square: what stands in for a logo that is not there. */
export function InitialsTile({ name, size, className = '', testId = 'entity-initials' }: { name: string | null | undefined; size: number; className?: string; testId?: string }) {
  return (
    <span aria-hidden="true" data-testid={testId} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-md bg-[#E8F4F8] font-semibold leading-none text-[#0E7490] ${className}`}>{initialsOf(name)}</span>
  );
}

/** The entity's logo, small — or its initials when there is none or it does not load. */
export function EntityLogo({ url, name, size = 28, className = '' }: { url: string | null | undefined; name?: string | null; size?: number; className?: string }) {
  const { failed, ref, onError } = useImageFailed(url);
  if (!url || failed) return <InitialsTile name={name} size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={url} alt="" width={size} height={size} loading="lazy" decoding="async" onError={onError} data-testid="entity-logo"
    className={`shrink-0 rounded-md bg-white object-contain ${className}`} style={{ width: size, height: size }} />;
}

/** The big logo over the cover's edge on the entry page — or the initials, in the same tile. */
export function LogoTile({ url, name }: { url: string | null | undefined; name: string | null | undefined }) {
  const { failed, ref, onError } = useImageFailed(url);
  const shown = !!url && !failed;
  return (
    <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white p-2 shadow-md sm:h-[88px] sm:w-[88px]" data-testid="intro-logo" data-logo={shown ? 'image' : 'initials'}>
      {shown
        // eslint-disable-next-line @next/next/no-img-element
        ? <img ref={ref} src={url} alt="" onError={onError} className="max-h-full max-w-full object-contain" />
        : <span aria-hidden="true" data-testid="intro-initials" className="select-none text-2xl font-semibold leading-none text-[#0E7490] sm:text-3xl">{initialsOf(name)}</span>}
    </span>
  );
}

/** The cover: the picture over the band in the platform's colour, which is all there is when there is no picture or it does not load. */
export function CoverBand({ url }: { url: string | null | undefined }) {
  const { failed, ref, onError } = useImageFailed(url);
  const shown = !!url && !failed;
  return (
    <div className="h-36 w-full overflow-hidden rounded-t-2xl bg-gradient-to-br from-[#0E7490] to-[#164e63] sm:h-52 md:h-60" data-testid="intro-cover" data-has-cover={shown ? 'yes' : 'no'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shown && <img ref={ref} src={url as string} alt="" onError={onError} className="h-full w-full object-cover" loading="eager" decoding="async" />}
    </div>
  );
}
