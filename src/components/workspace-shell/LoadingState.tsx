'use client';
// Prompt 126 F introduced this as `PipeLoadingState`, pipeline-only, to fix
// the "0 rows vs not-loaded-yet" bug. Prompt 127 Bloco A (addenda §5)
// generalized it into the app's one loading primitive — the only loading
// surface in the app with real brand identity, so it stays the default for
// every loading call site that adopts it, not just pipeline's (confirmed by
// grep, Prompt 674: it is in fact the ONLY call site today, so replacing
// this one component covers every screen the effect needs to reach).
//
// Prompt 674 — Nuno's own reference implementation is a magnifying glass
// sweeping left-to-right-to-left over the label, magnifying the letters
// directly beneath it, replacing the old pipe-smoke SVG. Ported from his
// attached working prototype (sherlock_loading_magnifier.html).
//
// Prompt 675 §1 — the FIRST port of this (this file's previous revision)
// regenerated the ENTIRE stylesheet string — including the live
// `@property --lens-x` registration and the `@keyframes` the running
// animation reads every frame — on every React re-render, because the
// track width was baked into that template string as a literal number.
// Replacing a <style> tag's textContent forces the browser to re-parse and
// re-register everything in it, including an `@property` an animation is
// actively mid-flight on; doing that repeatedly (this component re-renders
// on every resize, on every label change, and — critically — on every
// re-render of whatever parent is polling while `loading` is true) is what
// produced Nuno's "yOrp" bug: a live screenshot of the unclipped, scaled
// magnified layer mid-reparse, with the sweep barely moving because each
// reparse effectively restarted it. The prototype never has this problem
// because its <style> block is static, written once in <head>, and only
// ever touched again via `style.setProperty()` on the DOM node (a single
// custom-property write, not a stylesheet replacement).
//
// This revision ports that structure exactly: STYLE is a module-level
// constant, rendered once, and never depends on props or state. The track
// width is instead an actual CSS custom property (--sd-track-w) set via
// this component's `style` prop (React diffs and writes it with
// `style.setProperty`, never touching the <style> tag), with a CSS-side
// fallback (`var(--sd-track-w, 420px)`) so the sweep container always has a
// definite width — including before the first measurement — exactly like
// the reference file's `width: var(--track-w, 420px)`.
//
// Prompt 675 §1 — a second, independent bug, this one inherited FROM the
// reference file rather than introduced by porting it: confirmed by loading
// sherlock_loading_magnifier.html byte-for-byte, unmodified, and reading
// its own measurement in the console. base.getBoundingClientRect().width
// returns 420 — the sweep's OWN fallback width, not "Loading your
// pipeline…"'s real rendered width (216px, measured separately with a
// plain, unpositioned probe). The reason: the measured element itself is
// `position:absolute; inset:0` inside the sweep. For an absolutely
// positioned box with width:auto and BOTH left and right specified (inset:0
// sets all four to 0), CSS resolves width by solving
// left + width + right = containing block width — i.e. it stretches to
// fill its container, exactly like a plain block would. It never reports
// its own content's natural size; it reports whatever the sweep's width
// already was. That's self-referential — the "measurement" can only ever
// echo back the current fallback (or, after the one-time write, whatever
// --sd-track-w already holds) — so it can never converge on the real text
// width no matter how many times it runs. The visible effect was exactly
// Nuno's two complaints at once: a track built for 460px of space (title
// bar of Nuno's own screenshots) around a ~216px word puts real letters
// under the glass for only the middle ~47% of the sweep (looks like it
// "barely moves" across the phrase), and the reference file has never
// actually been exercised with a track width that matches its own text.
//
// Fix: measure with a SEPARATE, hidden, NOT stretched probe (visibility:
// hidden, no inset, free to size to its own content) instead of the visible
// overlay span. The visible base/magnified layers keep inset:0 + centering
// exactly as before — once the sweep's width is set from the probe's real
// number, centering them inside it is correct; it was only ever the
// MEASUREMENT that needed a box that could report its true width.
import { useEffect, useRef, useState } from 'react';

// Static, module-scope, rendered once — see the Prompt 675 note above for
// why this must never be rebuilt from a template literal on every render.
// `--sd-track-w`'s own fallback (420px) is the sweep's width before the
// first measurement lands; the keyframe's `to` value stays a calc()
// against the SAME custom property, one level of indirection but the exact
// technique the reference file uses, and the one this component broke by
// removing it.
const STYLE = `
  @property --lens-x {
    syntax: '<length>';
    inherits: true;
    initial-value: 20px;
  }
  .sd-lens-sweep {
    position: relative;
    height: 40px;
    width: var(--sd-track-w, 420px);
  }
  .sd-lens-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
  }
  /* Measurement-only — see the Prompt 675 note above. Free to size to its
     own content (no inset, no stretch): visibility:hidden removes it from
     paint but not from layout, so getBoundingClientRect() on it reports the
     label's real rendered width. */
  .sd-lens-probe {
    position: absolute;
    visibility: hidden;
    white-space: nowrap;
    top: 0;
    left: 0;
  }
  .sd-lens-magnified {
    color: #0E7490;
    font-weight: 700;
    /* Prompt 675 §1 — this radius is in the PRE-transform coordinate space,
       and the sibling scale(1.7) transform below multiplies whatever
       renders inside it: a 22px radius here was rendering as a ~37px
       radius (75px-diameter) circle on screen — wide enough to cover
       roughly 10 characters at this font size, not the 2-3 Nuno's own
       reference calls for. 10px pre-scale gives a ~17px effective radius
       (~34px diameter), comfortably inside the 40px glass and close to
       2-3 characters at 1.7x. */
    clip-path: circle(10px at var(--lens-x) 50%);
    transform: scale(1.7);
    transform-origin: var(--lens-x) 50%;
    pointer-events: none;
  }
  .sd-lens-glass {
    position: absolute;
    top: 50%;
    left: var(--lens-x);
    width: 40px;
    height: 40px;
    transform: translate(-50%, -50%) rotate(-40deg);
    pointer-events: none;
    filter: drop-shadow(0 2px 4px rgba(14, 116, 144, 0.25));
  }
  .sd-lens-animate {
    animation: sd-lens-sweep-x 2.6s cubic-bezier(.45,.05,.55,.95) infinite alternate;
  }
  @keyframes sd-lens-sweep-x {
    from { --lens-x: 20px; }
    to   { --lens-x: calc(var(--sd-track-w, 420px) - 20px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .sd-lens-animate { animation: none; }
    .sd-lens-glass { left: 20px; }
    .sd-lens-magnified { clip-path: circle(10px at 20px 50%); transform-origin: 20px 50%; }
  }
`;

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const baseRef = useRef<HTMLSpanElement>(null);
  // null = not measured yet — the CSS fallback (420px) governs the sweep's
  // width until then, and "animate" is withheld (see the bug note below for
  // why "animate" must never be the FIRST thing to render).
  const [trackW, setTrackW] = useState<number | null>(null);

  useEffect(() => {
    function measure() {
      const w = baseRef.current?.getBoundingClientRect().width ?? 0;
      if (w > 0) setTrackW(w + 40);
    }
    // Font loading can resolve after this first measurement (a web font
    // swapping in changes the label's true width); one re-measure once
    // fonts are ready costs nothing and keeps the track honest.
    document.fonts?.ready?.then(measure).catch(() => {});
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Re-measures whenever the label itself changes, same as the
    // prototype's own setText() — a track sized for a short label would
    // clip a longer one.
  }, [label]);

  // Bug found building the reference prototype, worth restating here since
  // it is a real, separate failure mode from the Prompt 675 one above: the
  // FIRST version put the "animate" class in the initial markup and set
  // --track-w afterwards. The measurement call (getBoundingClientRect)
  // forces a synchronous layout; if the animation is already running at
  // that moment, the browser resolves the "to" keyframe's calc() while
  // --sd-track-w is still unset, marks it invalid, and never re-resolves it
  // later even once a real value lands. The fix is ordering, not trickery:
  // never render "animate" before the property it depends on has a real
  // value. Here that ordering is structural — trackW is a single piece of
  // state, and the inline style (--sd-track-w) and the class
  // (sd-lens-animate) are both derived from it in the SAME render, so React
  // commits them to the DOM together; there is no point in time where one
  // exists without the other.
  const measured = trackW !== null;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <style>{STYLE}</style>
      <div
        className={`sd-lens-sweep ${measured ? 'sd-lens-animate' : ''}`}
        style={measured ? ({ '--sd-track-w': `${trackW}px` } as React.CSSProperties) : undefined}
      >
        <span ref={baseRef} className="sd-lens-probe text-sm" aria-hidden="true">{label}</span>
        <span className="sd-lens-text text-sm text-gray-400" aria-hidden="true">{label}</span>
        <span className="sd-lens-text sd-lens-magnified text-sm" aria-hidden="true">{label}</span>
        <span className="sd-lens-glass" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="40" height="40">
            <circle cx="16" cy="16" r="11" fill="#E8F4F8" fillOpacity="0.55" stroke="#0E7490" strokeWidth="2.5" />
            <circle cx="12.5" cy="12.5" r="3.5" fill="#FFFFFF" fillOpacity="0.6" />
            <line x1="24" y1="24" x2="36" y2="36" stroke="#0E7490" strokeWidth="4" strokeLinecap="round" />
            <line x1="25.3" y1="25.3" x2="34.5" y2="34.5" stroke="#0B4652" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}
