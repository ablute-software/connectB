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
// attached working prototype (sherlock_loading_magnifier.html) rather than
// re-derived from scratch — same technique, same bug fix, just the DOM
// ownership moved from getElementById lookups to refs/state so multiple
// mounted instances (however unlikely today) never collide on shared ids.
import { useEffect, useRef, useState } from 'react';

// A typed custom property is what makes --lens-x smoothly animatable via
// @keyframes — an unregistered custom property only ever flips discretely,
// it never interpolates. Declared once at module scope: redeclaring the same
// @property rule from more than one mounted instance is idempotent (same
// name, same syntax), never an error.
const LENS_PROPERTY_CSS = `
  @property --lens-x {
    syntax: '<length>';
    inherits: true;
    initial-value: 20px;
  }
`;

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const baseRef = useRef<HTMLSpanElement>(null);
  // null = not measured yet (renders static, no animation — see the bug
  // note below for why "animate" must never be the FIRST thing to render).
  const [trackW, setTrackW] = useState<number | null>(null);

  useEffect(() => {
    function measure() {
      const w = baseRef.current?.getBoundingClientRect().width ?? 0;
      setTrackW(w + 40);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Re-measures whenever the label itself changes, same as the
    // prototype's own setText() — a fixed track built for a short label
    // would clip a longer one.
  }, [label]);

  // Bug found building the reference prototype, worth restating here: the
  // FIRST version put the "animate" class in the initial markup and set
  // --track-w afterwards. That looked identical to smaller test cases that
  // worked, but the animation silently never moved — getBoundingClientRect()
  // (the measurement itself) forces a synchronous layout, and if the
  // animation is already running at that moment, the browser resolves the
  // "to" keyframe's calc(var(--track-w) - 20px) while --track-w is still
  // unset, marks it invalid, and never re-resolves it later even once
  // --track-w gets a real value a line down. The fix is ordering, not
  // trickery: never render "animate" before the property it depends on has
  // a real value. Here that ordering is structural rather than a manual
  // sequencing rule to remember — trackW is a single piece of state, and the
  // style (--track-w) and the class (sd-lens-animate) are both derived from
  // it in the SAME render, so React commits them to the DOM together; there
  // is no point in time where one exists without the other.
  const measured = trackW !== null;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <style>{`
        ${LENS_PROPERTY_CSS}
        .sd-lens-sweep {
          position: relative;
          height: 40px;
          width: ${measured ? `${trackW}px` : 'auto'};
        }
        .sd-lens-text {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }
        .sd-lens-magnified {
          color: #0E7490;
          font-weight: 700;
          clip-path: circle(22px at var(--lens-x) 50%);
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
        /* The reference prototype kept the track width in a second custom
           property (--track-w) and referenced it from this keyframe as
           calc(var(--track-w) - 20px) — which is exactly the shape that bit
           it (a calc() resolved while its custom property was still unset).
           There is no need for that indirection here: trackW is already a
           plain number in this component's own state, so the "to" value
           below is a literal pixel value baked into the stylesheet text at
           render time, not a var() reference — the whole class of bug the
           prototype's note warns about has nothing left to happen to. */
        @keyframes sd-lens-sweep-x {
          from { --lens-x: 20px; }
          to   { --lens-x: ${measured ? trackW! - 20 : 0}px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sd-lens-animate { animation: none; }
          .sd-lens-glass { left: 20px; }
          .sd-lens-magnified { clip-path: circle(22px at 20px 50%); transform-origin: 20px 50%; }
        }
      `}</style>
      <div className={`sd-lens-sweep ${measured ? 'sd-lens-animate' : ''}`}>
        <span ref={baseRef} className="sd-lens-text text-sm text-gray-400" aria-hidden="true">{label}</span>
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
