'use client';
// Nuno's 15/09/2026 redesign of the /investors hero+video work — moves the
// 60s product walkthrough out of the hero (which reverts to the "Deal flow
// review" table, exactly as in production) and into its own full-width slot
// at the top of "How it works" (src/app/investors/page.tsx).
//
// Autoplay-with-sound design (Nuno's own spec, verbatim):
// 1. Arriving via the hero's "See how it works" button (SeeHowButton.tsx) is
//    a user gesture — that component calls this <video>'s .play() with sound
//    on, synchronously, before starting the smooth scroll. This component
//    does not initiate that call itself; it only reacts to the video
//    element's own native events (play/pause/volumechange) to decide whether
//    to show the "Tap for sound" fallback chip, so it works regardless of
//    which caller started playback.
// 2. If SeeHowButton's unmuted play() rejects (NotAllowedError — strict
//    browsers, unusual extension setups), it falls back to muted playback,
//    which is always allowed. This component shows "Tap for sound" any time
//    the video is playing muted (not just right after that specific
//    fallback) — simpler than threading a one-shot flag across components,
//    and correct for the same reason: playing + muted always means "the
//    visitor wants sound but doesn't have it yet."
// 3. Arriving without a gesture (direct link to /investors#how, scrolling
//    down, or from /investors/video) shows the poster ("1/100" frame) with
//    the browser's native play button — no autoplay, muted or otherwise, is
//    ever set here. A silent video starting mid-scroll reads as an ad.
// 4. playsInline + preload="metadata" (not "auto" — this is a real ~4MB file,
//    no reason to fetch it before anyone asks); native `controls` always on,
//    so the native play button IS the poster's call to action; no `loop`
//    (60s should end on the CTA frame, not restart). The poster stays a
//    plain <video poster> attribute (not a separately mounted <img> the way
//    the old hero component delayed its own video tag) — browsers treat a
//    poster-bearing <video> as an LCP-eligible image element on first paint.
import { useEffect, useRef, useState } from 'react';
import s from '../../app/landing.module.css';

export const HOW_VIDEO_ID = 'how-video';

export function HowItWorksVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tapForSound, setTapForSound] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function syncTapForSound() {
      if (!video) return;
      setTapForSound(!video.paused && video.muted);
    }
    // Verification hook (Nuno's spec item 6 — log which path each run took):
    // the first 'playing' event after SeeHowButton marks the video with
    // data-via-button ('1' unmuted, '2' the muted fallback); any 'playing'
    // event without that marker is path 3, a native-control click. Cleared
    // after being read once so a later pause/resume via native controls
    // isn't mis-attributed to the button.
    function logPath() {
      if (!video) return;
      const viaButton = video.dataset.viaButton;
      const path = viaButton ? (video.muted ? '2' : '1') : '3';
      // eslint-disable-next-line no-console -- deliberate verification signal, not app logging
      console.log(`[how-video] path=${path}`);
      delete video.dataset.viaButton;
    }

    video.addEventListener('play', syncTapForSound);
    video.addEventListener('pause', syncTapForSound);
    video.addEventListener('volumechange', syncTapForSound);
    video.addEventListener('playing', logPath);
    return () => {
      video.removeEventListener('play', syncTapForSound);
      video.removeEventListener('pause', syncTapForSound);
      video.removeEventListener('volumechange', syncTapForSound);
      video.removeEventListener('playing', logPath);
    };
  }, []);

  function unmute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
  }

  return (
    <div className={s.howVideoFrame}>
      <video
        id={HOW_VIDEO_ID}
        ref={videoRef}
        className={s.howVideo}
        poster="/video/investors-poster.jpg"
        controls
        playsInline
        preload="metadata"
        aria-label="Sherlock Deal, 60-second walkthrough"
      >
        <source src="/video/investors-60.webm" type="video/webm" />
        <source src="/video/investors-60.mp4" type="video/mp4" />
      </video>
      {tapForSound && (
        <button type="button" className={s.tapForSound} onClick={unmute}>
          Tap for sound
        </button>
      )}
    </div>
  );
}
