// Prompt 926 (30/10/2026; carousel back and out of the hero 31/10/2026, Nuno) — the logos of the companies on the landing pages, at the START OF THE LIGHT AREA right under the hero (under the dark bar
// of checks on the startups page; directly under the dark hero on the investors page). It is not a band of its own: no background, no borders, no cards, no circles — a centred title and ONE row of logos
// that slides left on its own, on the page's own colour, so the area goes on, unbroken, into the section that follows (landing.module.css gives that section a moderate top padding when it comes right after).
//
// A carousel and never a grid, at every width: a fixed grid of logos reads as "these are all the organisations on the platform", which is what the title says they are not (they are examples). It moves
// continuously and smoothly, at the same speed in CSS px per second on every screen (landing-logos.ts: `loopSeconds`, one duration for the desktop's list and one for the phone's), the logos enter and
// leave at the edges and fade into the page there, the pointer or a finger on it stops it, and "reduce motion" in the system leaves it still.
//
// No client code: the list slides left by CSS alone (transform only), repeated once so the turn has no seam (`LOOP_COPIES`). The copy is the same logos again,
// only for the movement to be seamless: it is aria-hidden with empty alt text, so a screen reader meets each company once. No links: a logo here is a statement, not a door.
//
// Every logo is drawn at a box worked out here (`logoBoxes`): the same AREA for all (times its own optical weight, if it has one), so a long wordmark and a squarer mark weigh the same to the eye, and each
// keeps the shape of its own file. The window the logos move in is as wide as the real logos allow and no wider (`logoWindows`): a window longer than one turn of the list would show a brand at both ends
// at once, so with eight startups it is ~1.2k px, centred, and with seventeen investors it is the whole screen.
import type { CSSProperties } from 'react';
import { LOGO_STRIP_FADE, LOGO_STRIP_LABEL, LOGO_STRIP_SIZES, LOGO_STRIP_SPEED } from '@/content/site/logo-strip';
import { LOOP_COPIES, logoBoxes, logoWindows, loopSeconds, stripVisible, type LandingLogo, type LogoPage, type LogoStripSizes } from '@/lib/landing-logos';
import s from '@/app/landing.module.css';

export const LOGO_FOLDER = '/landing/logos/';

export function LogoStrip({ page, logos, sizes = LOGO_STRIP_SIZES, pxPerSecond = LOGO_STRIP_SPEED, fade = LOGO_STRIP_FADE }: {
  page: LogoPage;
  /** Already authorized and meant for this page (landingLogosFor). The strip checks the minimum again: it is the last gate before the public sees a name. */
  logos: readonly LandingLogo[];
  sizes?: LogoStripSizes;
  /** How fast the logos move, in CSS px per second, on every screen. */
  pxPerSecond?: number;
  /** How far each end of the window fades into the page, in CSS px, on a laptop and on a phone. */
  fade?: { readonly desktop: number; readonly phone: number };
}) {
  if (!stripVisible(logos)) return null;
  const label = LOGO_STRIP_LABEL[page];
  const desktop = logoBoxes(logos, sizes.desktop);
  const phone = logoBoxes(logos, sizes.phone);
  const windows = logoWindows(logos, sizes);
  const titleId = `logo-strip-title-${page}`;

  const style = {
    '--logo-gap': `${sizes.desktop.gap}px`, '--logo-gap-phone': `${sizes.phone.gap}px`,
    '--logo-maxh': `${sizes.desktop.maxHeight}px`, '--logo-maxh-phone': `${sizes.phone.maxHeight}px`,
    '--logo-window': `${windows.desktop}px`, '--logo-window-phone': `${windows.phone}px`,
    '--logo-fade': `${fade.desktop}px`, '--logo-fade-phone': `${fade.phone}px`,
    '--logo-copies': LOOP_COPIES,
    '--logo-loop': `${loopSeconds(logos, sizes.desktop, pxPerSecond)}s`, '--logo-loop-phone': `${loopSeconds(logos, sizes.phone, pxPerSecond)}s`,
  } as CSSProperties;

  // The same <ul> once for people and assistive technology, and again (hidden from them) for the seam.
  const list = (copy: number) => (
    <ul key={copy} className={s.logoList} aria-hidden={copy > 0 ? true : undefined}>
      {logos.map((l, i) => (
        <li key={l.file} className={s.logoItem} style={{ '--w': desktop[i].width, '--wp': phone[i].width } as CSSProperties}>
          {/* A plain <img>: the files are small and static, served as they are from /public, and next/image would put a resize service in front of a strip that must not wait for one.
              Not lazy: a logo that is still outside the window would load just as it slides in. fetchPriority low: the logos are the last thing the page needs, so they never take the network
              from the text, the fonts or the styles. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.logoImg} src={`${LOGO_FOLDER}${l.file}`} alt={copy > 0 ? '' : l.name} width={l.width} height={l.height} decoding="async" fetchPriority="low" draggable={false} />
        </li>
      ))}
    </ul>
  );

  return (
    <section className={s.logoStrip} aria-labelledby={titleId} data-logo-strip={page} style={style}>
      <div className={s.wrap}>
        <h2 id={titleId} className={s.logoTitle}>{label}</h2>
      </div>
      <div className={s.logoWindow}>
        <div className={s.logoTrack}>
          {Array.from({ length: LOOP_COPIES }, (_, copy) => list(copy))}
        </div>
      </div>
    </section>
  );
}
