'use client';
// Nuno's 15/09/2026 spec, verbatim: "In the click handler, call video.play()
// synchronously, first, with muted = false, and only then start the smooth
// scroll. Do not put play() after scrollIntoView, inside a setTimeout, or in
// a scroll-end callback: Safari (desktop and iOS) only honours the gesture
// while the handler is on the stack."
//
// A plain onClick can't be authored on the hero's Link inside
// src/app/investors/page.tsx (a Server Component — functions can't cross
// that boundary), so this is its own tiny client component, same pattern as
// HowItWorksVideo/AudienceToggle elsewhere on this page. It talks to
// HowItWorksVideo.tsx purely through the shared <video id> in the DOM and a
// data attribute — no React state crosses the two components, so either can
// change independently.
import Link from 'next/link';
import { HOW_VIDEO_ID } from './HowItWorksVideo';

export function SeeHowButton({ className }: { className?: string }) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    const video = document.getElementById(HOW_VIDEO_ID) as HTMLVideoElement | null;
    if (video) {
      // Marks this playback start as button-initiated for HowItWorksVideo's
      // own verification logging; read once then cleared there.
      video.dataset.viaButton = '1';
      video.muted = false;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Strict browser or unusual extension setup rejected unmuted
          // playback — fall back to muted (always allowed) rather than
          // leaving a frozen poster after the visitor explicitly asked to
          // see how it works. HowItWorksVideo shows "Tap for sound" for as
          // long as the video is playing muted, however that happened.
          video.muted = true;
          void video.play();
        });
      }
    }
    // Started only after play() has already been called above, per spec —
    // never inside a timeout or a scroll-end callback.
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <Link className={className} href="#how" onClick={handleClick}>See how it works</Link>
  );
}
