'use client';
// Prompt 86 Bloco 2 (§5, §6, §9, §13) — per-page step-by-step tour. Distinct
// from WelcomeModal on purpose: dismissible at any point (backdrop click,
// Escape, X) — the popup is a decision, this is help. Fires automatically
// once per pageKey (reactive on `seen[pageKey]` from OnboardingProvider,
// see its doc comment), and re-fires from step 1 whenever a "?" button
// calls rearmKey(pageKey).
//
// Adapting to missing elements (§9): steps are resolved against
// `[data-tour-id="<selector>"]` in the real DOM at open time. A step whose
// anchor isn't there is dropped, never invented, and the counter reflects
// only the steps that survived. Fewer than 2 valid steps -> the tour does
// not open at all this pass (nothing to walk through).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import { TOUR_CONTENT, type TourStep } from '@/lib/onboarding/tourContent';

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
  const { seen, loaded, markSeen } = useOnboarding();
  const steps = TOUR_CONTENT[pageKey] ?? [];
  const alreadySeen = !!seen[pageKey];
  const [stepIndex, setStepIndex] = useState(0);
  const [resolved, setResolved] = useState<ResolvedStep[] | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const balloonRef = useRef<HTMLDivElement>(null);

  // The tour is eligible once, reactively, whenever this page's key isn't
  // in `seen` yet — the "?" button rearms by deleting the key, which flips
  // this back to true and (via the effect below) restarts at step 0.
  const wantsOpen = loaded && !alreadySeen && steps.length > 0;

  useEffect(() => {
    if (!wantsOpen) { setResolved(null); return; }
    setStepIndex(0);
    // Resolve anchors on open, not on every render — the DOM is settled by
    // the time this page's real content (not a loading placeholder) is
    // mounted, which is when PageTour itself gets mounted by the caller.
    const found: ResolvedStep[] = [];
    for (const step of steps) {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.selector}"]`);
      if (el) found.push({ ...step, rect: el.getBoundingClientRect() });
    }
    if (found.length < 2) { setResolved(null); return; }
    setResolved(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsOpen]);

  const current = resolved?.[stepIndex] ?? null;

  useEffect(() => {
    if (!current) return;
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${current.selector}"]`);
    el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    balloonRef.current?.focus();
  }, [current, reducedMotion]);

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

  // Balloon placement: below the target if there's room, otherwise above.
  const spaceBelow = window.innerHeight - r.bottom;
  const placeBelow = spaceBelow > 160 || r.top < 160;
  const top = placeBelow ? r.bottom + BALLOON_GAP : undefined;
  const bottom = !placeBelow ? window.innerHeight - r.top + BALLOON_GAP : undefined;
  const left = Math.min(Math.max(r.left, 12), window.innerWidth - BALLOON_WIDTH - 12);

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
        style={{ width: BALLOON_WIDTH, left, top, bottom }}>
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
