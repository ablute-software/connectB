'use client';
// Prompt 688 Bloco A — replaces the static "DEAL FLOW REVIEW" mock table in
// the /investors hero with the real 60s product walkthrough. Lives in its
// own client component because the parent page (src/app/investors/page.tsx)
// is a server component doing role-based redirects; hover/click/media-query
// interactivity has to be isolated here instead of promoting the whole page
// to a client component.
//
// The <video> element is created only after mount (see `ready` below) so its
// `preload`/`autoPlay` attributes are already correct on the very first paint
// of the real element — deciding the viewport via matchMedia and then
// re-rendering the same tag with different attributes would be too late for
// `preload`, since the browser has already started (or skipped) the fetch by
// then. Until mounted, the poster image alone is rendered at the same size,
// so there is no layout shift and no extra network request beyond the poster.
import { useEffect, useRef, useState } from 'react';
import s from '../../app/landing.module.css';

const MOBILE_QUERY = '(max-width: 900px)'; // matches the site's own breakpoint (landing.module.css)
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function InvestorHeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    setIsMobile(window.matchMedia(MOBILE_QUERY).matches);
    setReducedMotion(window.matchMedia(REDUCED_MOTION_QUERY).matches);
    setReady(true);
  }, []);

  function watchWithSound() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.controls = true;
    setHovering(true);
    void el.play();
  }

  const shouldAutoplay = !reducedMotion;

  return (
    <div className={s.heroVideoFrame}>
      {ready ? (
        <video
          ref={videoRef}
          className={s.heroVideo}
          poster="/video/investors-poster.jpg"
          muted
          loop
          playsInline
          autoPlay={shouldAutoplay}
          preload={isMobile ? 'metadata' : 'auto'}
          controls={hovering}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onClick={(e) => {
            // Chrome's native <video controls> toggles play/pause on a body
            // click once controls are shown (from the hover above) — that
            // fires alongside this handler, so a plain click-to-unmute would
            // also silently pause the video. Put it back if this click was
            // the one that paused it, so unmuting never doubles as stopping.
            const el = e.currentTarget;
            const wasPaused = el.paused;
            el.muted = !el.muted;
            if (!wasPaused && el.paused) void el.play();
          }}
          aria-label="Sherlock Deal investor workspace, 60-second walkthrough"
        >
          <source src="/video/investors-60.webm" type="video/webm" />
          <source src="/video/investors-60.mp4" type="video/mp4" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- poster is a
        // pre-generated static asset, not something next/image needs to optimise
        <img
          src="/video/investors-poster.jpg"
          alt="Sherlock Deal investor workspace"
          className={s.heroVideo}
        />
      )}
      {/* Hidden while hovering: that's when the native controls (which
          already include a mute toggle) are showing, so a second "turn the
          sound on" prompt would just be redundant clutter sitting on top of
          them in the same bottom-right corner. */}
      {!hovering && (
        <button type="button" className={s.watchSound} onClick={watchWithSound}>
          Watch with sound
        </button>
      )}
    </div>
  );
}
