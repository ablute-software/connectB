// Prompt 926 (30/10/2026) — the strip of logos of companies already on the platform, the last thing in the landing's hero: under the dark bar of checks on the startups page,
// at the foot of the hero on the investors page (which has no bar), and before the "Already in our database" section there. Two rows: the heading (one centred line, in the
// brand's amber, on the same dark as the bar above it) and the row of logos (white).
//
// No client code: a list of logos that slides left by CSS alone (transform only), repeated so the turn has no seam — see landing-logos.ts (`loopCopies`) for how
// many copies. Hover stops it; "reduce motion" in the system leaves it still, showing the logos that fit. No links: a logo here is a statement, not a door.
//
// Accessibility: the strip is one labelled region, announced once. Only the first copy of the list is read — each logo by the company's name — and the other
// copies are aria-hidden with empty alt text. The visible label is aria-hidden too, because the region's name already says it.
import type { CSSProperties } from 'react';
import { LOGO_STRIP_LABEL, LOGO_STRIP_LOOP_SECONDS, LOGO_STRIP_SIZES } from '@/content/site/logo-strip';
import { loopCopies, stripVisible, type LandingLogo, type LogoPage, type LogoStripSizes } from '@/lib/landing-logos';
import s from '@/app/landing.module.css';

export const LOGO_FOLDER = '/landing/logos/';

export function LogoStrip({ page, logos, sizes = LOGO_STRIP_SIZES, loopSeconds = LOGO_STRIP_LOOP_SECONDS }: {
  page: LogoPage;
  /** Already authorized and meant for this page (landingLogosFor). The strip checks the minimum again: it is the last gate before the public sees a name. */
  logos: readonly LandingLogo[];
  sizes?: LogoStripSizes;
  loopSeconds?: number;
}) {
  if (!stripVisible(logos)) return null;
  const label = LOGO_STRIP_LABEL[page];
  const copies = loopCopies(logos, sizes);

  const style = {
    '--logo-h': `${sizes.height}px`, '--logo-gap': `${sizes.gap}px`, '--logo-maxw': `${sizes.maxWidth}px`,
    '--logo-h-phone': `${sizes.heightPhone}px`, '--logo-gap-phone': `${sizes.gapPhone}px`, '--logo-maxw-phone': `${sizes.maxWidthPhone}px`,
    '--logo-copies': copies, '--logo-loop': `${loopSeconds}s`,
  } as CSSProperties;

  // The same <ul> once for people and assistive technology, and again (hidden from them) for the seam.
  const list = (copy: number) => (
    <ul key={copy} className={s.logoList} aria-hidden={copy > 0 ? true : undefined}>
      {logos.map((l) => (
        <li key={l.file} className={s.logoItem}>
          {/* A plain <img>: the files are small and static, served as they are from /public, and next/image would put a resize service in front of a strip that must not wait for one.
              fetchPriority low: the logos are the last thing the page needs, so they never take the network from the text, the fonts or the styles. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.logoImg} src={`${LOGO_FOLDER}${l.file}`} alt={copy > 0 ? '' : l.name} width={l.width} height={l.height} decoding="async" fetchPriority="low" draggable={false} />
        </li>
      ))}
    </ul>
  );

  return (
    <section className={s.logoStrip} aria-label={label} data-logo-strip={page} style={style}>
      <div className={s.logoHead}>
        <p className={s.logoLabel} aria-hidden="true">{label}</p>
      </div>
      <div className={s.logoInner}>
        <div className={s.logoWindow}>
          <div className={s.logoTrack}>
            {Array.from({ length: copies }, (_, copy) => list(copy))}
          </div>
        </div>
      </div>
    </section>
  );
}
