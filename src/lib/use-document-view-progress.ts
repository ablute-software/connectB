'use client';
// Prompt 742 §D.3 — the viewer page's own heartbeat, same shape as
// use-usage-heartbeat.ts (visible + recent activity within the last 60s
// counts as active; ticks accumulate locally, a ~30s aggregate is what
// actually gets sent, and a flush never double-counts because the
// accumulator is zeroed the moment it sends). Distinct pages seen is
// reported as the full cumulative count each flush, not a delta — the
// server takes the max of what it already has vs. what's freshly
// reported (D.3's own `greatest(...)`), so re-sending the same count is
// always safe.
import { useCallback, useEffect, useRef } from 'react';

const ACTIVE_IDLE_THRESHOLD_MS = 60_000;
const TICK_INTERVAL_MS = 5_000;
const FLUSH_INTERVAL_MS = 30_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'scroll'] as const;
// D.3 — "a page counts as seen if it was ≥2s with ≥50% on screen".
const PAGE_SEEN_MS = 2_000;
const PAGE_SEEN_RATIO = 0.5;

export function useDocumentViewProgress(endpoint: string, viewId: string | null) {
  const pendingActiveRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const lastTickAtRef = useRef(Date.now());
  const seenPagesRef = useRef<Set<number>>(new Set());
  const pageTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!viewId || typeof window === 'undefined') return;

    function markActivity() { lastActivityAtRef.current = Date.now(); }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));

    function tick() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      const deltaSec = (now - lastTickAtRef.current) / 1000;
      lastTickAtRef.current = now;
      if (now - lastActivityAtRef.current < ACTIVE_IDLE_THRESHOLD_MS) pendingActiveRef.current += deltaSec;
    }
    const tickTimer = setInterval(tick, TICK_INTERVAL_MS);

    function flush(ended: boolean) {
      tick();
      const activeSecondsDelta = Math.round(pendingActiveRef.current);
      const distinctPagesSeen = seenPagesRef.current.size;
      if (activeSecondsDelta === 0 && distinctPagesSeen === 0 && !ended) return;
      pendingActiveRef.current = 0;
      const payload = JSON.stringify({ viewId, activeSecondsDelta, distinctPagesSeen });
      if (ended && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: ended }).catch(() => {});
      }
    }
    const flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);

    function onVisibilityChange() { if (document.visibilityState === 'hidden') flush(true); }
    document.addEventListener('visibilitychange', onVisibilityChange);
    function onPageHide() { flush(true); }
    window.addEventListener('pagehide', onPageHide);

    const pageTimers = pageTimersRef.current;
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, markActivity));
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
      for (const t of pageTimers.values()) clearTimeout(t);
      pageTimers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, viewId]);

  // The PDF renderer's own IntersectionObserver calls this on every
  // ratio change for a page's canvas; a page only ever gets recorded once
  // it's held ≥50% visible continuously for ≥2s (dropping below cancels
  // the pending timer — no credit for a quick scroll-past).
  const markPageIntersection = useCallback((pageNum: number, ratio: number) => {
    const timers = pageTimersRef.current;
    if (ratio >= PAGE_SEEN_RATIO) {
      if (timers.has(pageNum) || seenPagesRef.current.has(pageNum)) return;
      timers.set(pageNum, setTimeout(() => {
        seenPagesRef.current.add(pageNum);
        timers.delete(pageNum);
      }, PAGE_SEEN_MS));
    } else {
      const t = timers.get(pageNum);
      if (t) { clearTimeout(t); timers.delete(pageNum); }
    }
  }, []);

  return { markPageIntersection };
}
