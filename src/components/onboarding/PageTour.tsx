'use client';
// Prompt 86 Bloco 2 (§5, §6, §9, §13) — per-page step-by-step tour. Distinct
// from WelcomeModal on purpose: dismissible at any point (backdrop click,
// Escape, X) — the popup is a decision, this is help. Fires automatically
// once per pageKey (reactive on `seen[pageKey]` from OnboardingProvider),
// and re-fires from step 1 whenever a "?" button calls rearmKey(pageKey) —
// tracked via `guideNonce`, not just the seen/unseen edge (see the effect
// below and OnboardingProvider's doc comment for why both are needed).
//
// Adapting to missing elements (§9): steps are resolved against
// `[data-tour-id="<selector>"]` in the real DOM at open time. A step whose
// anchor isn't there is dropped, never invented, and the counter reflects
// only the steps that survived. Fewer than 2 valid steps -> the tour does
// not open at all this pass (nothing to walk through).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import { TOUR_CONTENT, type TourStep } from '@/lib/onboarding/tourContent';
import { tourMayOpen } from '@/lib/onboarding/tour-gate';

interface ResolvedStep extends TourStep { rect: DOMRect }

const BALLOON_WIDTH = 320;
const BALLOON_GAP = 14;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function PageTour({ pageKey }: { pageKey: string }) {
  const { seen, loaded, markSeen, guideNonce, toursHeld } = useOnboarding();
  const steps = TOUR_CONTENT[pageKey] ?? [];
  const alreadySeen = !!seen[pageKey];
  const nonce = guideNonce[pageKey] ?? 0;
  const [stepIndex, setStepIndex] = useState(0);
  const [resolved, setResolved] = useState<ResolvedStep[] | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const balloonRef = useRef<HTMLDivElement>(null);

  // The tour is eligible once loaded, not held by a blocking overlay, and
  // not yet seen for this key. `nonce` is the "?" button's own re-open
  // signal — it bumps on every click, independent of the seen/unseen edge,
  // so a click still does something even when the key had never been seen
  // in the first place (a !seen[key]-only dependency misses that case:
  // nothing "changes").
  //
  // Prompt 549 — `toursHeld` is the new term, and the effect below already
  // depends on wantsOpen, so this needs nothing else: a hold appearing
  // while a tour is open closes it (setResolved(null)), and the hold
  // clearing re-runs anchor resolution from step 1. That IS "Got it -> the
  // tour starts", with no extra click, no refresh and no timer. A "?" click
  // while a hold is active correctly does nothing until the hold clears.
  const wantsOpen = tourMayOpen({ loaded, held: toursHeld, seen: alreadySeen, stepCount: steps.length });

  useEffect(() => {
    if (!wantsOpen) { setResolved(null); return; }
    setStepIndex(0);
    let cancelled = false;
    let attempt = 0;
    // Anchors resolve against the real DOM, but the page around them can
    // still be mid-load (e.g. CompanyPanel's own async /api/me fetch) at
    // the exact moment this effect first runs — a single immediate query
    // found live to silently and permanently fail the tour (Prompt 86
    // Bloco 2 bug report). Retry on a short interval instead of once.
    function tryResolve() {
      if (cancelled) return;
      const found: ResolvedStep[] = [];
      for (const step of steps) {
        const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.selector}"]`);
        if (el) found.push({ ...step, rect: el.getBoundingClientRect() });
      }
      if (found.length >= 2) { setResolved(found); return; }
      attempt += 1;
      if (attempt < 20) setTimeout(tryResolve, 150); // ~3s total before giving up quietly
      else setResolved(null);
    }
    tryResolve();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsOpen, nonce]);

  const current = resolved?.[stepIndex] ?? null;
  // Measured after render, not guessed from the anchor's height alone —
  // found live: a tall anchor (e.g. the Identity card, 472px) was placing
  // the panel below it unconditionally whenever the anchor's own top was
  // < 160px, overflowing the viewport with no way to scroll to it (the
  // tour overlay is position:fixed; scroll was locked). Two-pass layout:
  // render once to measure this panel's real height via balloonRef, then
  // clamp its top so it always fits, overlapping the spotlight if neither
  // above nor below has room — useLayoutEffect runs before paint, so
  // there's no visible flash at the wrong position.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  // Round 2 of the same bug, found live: with 4 anchors stacked ~1000px
  // deep on this page alone, a later step's anchor can start the step
  // already scrolled OUT of the viewport (rect.top/bottom way past
  // innerHeight) — clamping relative to that anchor produces a panel
  // that's correctly placed *next to the anchor* and still entirely off
  // screen, because the anchor itself never was on screen. Scrolling it
  // into view has to happen, and be re-measured, BEFORE the clamp math —
  // not as a separate effect that fires after paint (that raced and lost:
  // the wrong position painted first, and nothing re-triggered a redo).
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  useLayoutEffect(() => {
    const step = resolvedRef.current?.[stepIndex];
    if (!step || !balloonRef.current) { setPanelPos(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.selector}"]`);
    if (!el) { setPanelPos(null); return; }
    // Instant, not smooth — a smooth scroll animates over several frames,
    // so getBoundingClientRect() right after it would still read the
    // pre-scroll position. Correctness over the animation here.
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
    const freshRect = el.getBoundingClientRect();
    setResolved((prev) => prev?.map((s, i) => (i === stepIndex ? { ...s, rect: freshRect } : s)) ?? prev);

    const margin = 12;
    const panelHeight = balloonRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - freshRect.bottom - BALLOON_GAP;
    const spaceAbove = freshRect.top - BALLOON_GAP;
    let top: number;
    if (spaceBelow >= panelHeight) top = freshRect.bottom + BALLOON_GAP;
    else if (spaceAbove >= panelHeight) top = freshRect.top - BALLOON_GAP - panelHeight;
    else top = Math.max(margin, Math.min(freshRect.bottom + BALLOON_GAP, window.innerHeight - panelHeight - margin));
    const left = Math.min(Math.max(freshRect.left, margin), window.innerWidth - BALLOON_WIDTH - margin);
    setPanelPos({ top, left });
    balloonRef.current.focus();
    // resolved !== null (not resolved itself) — this effect's own setResolved
    // call above must not retrigger it; only a real step change should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, resolved !== null]);

  // Keep the highlighted rect current across scroll/resize while open.
  useEffect(() => {
    if (!resolved) return;
    function reposition() {
      setResolved((prev) => prev?.map((s) => {
        const el = document.querySelector<HTMLElement>(`[data-tour-id="${s.selector}"]`);
        return el ? { ...s, rect: el.getBoundingClientRect() } : s;
      }) ?? null);
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [resolved]);

  function close() { markSeen(pageKey); }

  useEffect(() => {
    if (!resolved) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const maskId = useMemo(() => `tour-mask-${pageKey}`, [pageKey]);

  if (!resolved || !current || typeof document === 'undefined') return null;

  const total = resolved.length;
  const pad = 8;
  const r = current.rect;

  return createPortal(
    <div className="fixed inset-0 z-[60]" onClick={close}>
      {/* Spotlight: dims the page, cuts a hole around the current anchor via SVG mask. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect x={r.left - pad} y={r.top - pad} width={r.width + pad * 2} height={r.height + pad * 2}
              rx="10" fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(15,23,42,0.55)" mask={`url(#${maskId})`} />
      </svg>
      <div className="pointer-events-none absolute rounded-[10px] ring-2 ring-[#0E7490]"
        style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />

      <div ref={balloonRef} tabIndex={-1} role="dialog" aria-live="polite" aria-label={current.title}
        onClick={(e) => e.stopPropagation()}
        className={`absolute rounded-2xl bg-white p-5 shadow-2xl ${reducedMotion ? '' : 'onboarding-modal-enter'}`}
        style={{
          width: BALLOON_WIDTH,
          left: panelPos?.left ?? r.left,
          top: panelPos?.top ?? r.bottom + BALLOON_GAP,
          visibility: panelPos ? 'visible' : 'hidden',
        }}>
        <button onClick={close} aria-label="Close tour"
          className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">✕</button>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#0E7490]">{stepIndex + 1} / {total}</p>
        <h3 className="mb-1.5 pr-5 text-[15px] font-semibold text-gray-900">{current.title}</h3>
        <p className="text-[13.5px] leading-[1.5] text-gray-600">{current.body}</p>
        <div className="mt-4 flex items-center gap-2">
          {stepIndex > 0 && (
            <button onClick={() => setStepIndex((i) => i - 1)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-50">
              Previous
            </button>
          )}
          <button
            onClick={() => (stepIndex === total - 1 ? close() : setStepIndex((i) => i + 1))}
            className="ml-auto rounded-lg bg-[#0E7490] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#0c637b]">
            {stepIndex === total - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
