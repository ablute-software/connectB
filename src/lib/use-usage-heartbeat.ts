'use client';
// Prompt 295 §1 — heartbeat hook mounted in the CRM shell (shell.tsx),
// the backoffice shell (backoffice/layout.tsx), and the MatchDeal PWA
// (pair/layout.tsx via MatchDealHeartbeat.tsx) — three contexts, one hook.
//
// "A session = one tab open until hidden/closed." Going hidden ends the
// current session (flush ended:true) and clears the session id; becoming
// visible again starts a genuinely NEW session (new id) rather than
// resuming the old one — matches the prompt's own definition literally,
// and keeps a session's active/standby split honest (re-opening a tab
// after a day away is a new visit, not a very long standby stretch).
//
// active = real interaction (mousemove/keydown/touchstart/scroll) within
// the last ~60s while visible. standby = visible, no interaction that
// recently. Hidden = neither — explicitly not standby, per the prompt.
//
// Deliberately NOT one row/write per heartbeat (explicit ask, to avoid
// saturating the system or driving up cost): ticks accumulate in refs
// every 5s, and only a per-~60s aggregate delta is ever sent to the
// server — flush() zeroes the accumulators every time it actually sends,
// so a flush failure only ever loses the last ~60s, never double-counts.
import { useEffect, useRef } from 'react';

const ACTIVE_IDLE_THRESHOLD_MS = 60_000;
const FLUSH_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 5_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'scroll'] as const;

export type UsageContext = 'crm' | 'backoffice' | 'matchdeal';

export interface UseUsageHeartbeatParams {
  context: UsageContext;
  // False in demo mode, or before the caller has resolved enough identity
  // to log anything meaningful (e.g. MatchDeal before /self resolves).
  enabled: boolean;
  matchdealProfileId?: string | null;
  matchdealKind?: 'startup' | 'investor' | null;
}

export function useUsageHeartbeat({ context, enabled, matchdealProfileId, matchdealKind }: UseUsageHeartbeatParams) {
  const sessionIdRef = useRef<string | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const lastTickAtRef = useRef(Date.now());
  const pendingActiveRef = useRef(0);
  const pendingStandbyRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    function newSession() {
      sessionIdRef.current = crypto.randomUUID();
      lastActivityAtRef.current = Date.now();
      lastTickAtRef.current = Date.now();
      pendingActiveRef.current = 0;
      pendingStandbyRef.current = 0;
    }
    if (document.visibilityState === 'visible') newSession();

    function markActivity() { lastActivityAtRef.current = Date.now(); }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));

    function tick() {
      if (document.visibilityState !== 'visible' || !sessionIdRef.current) return;
      const now = Date.now();
      const deltaSec = (now - lastTickAtRef.current) / 1000;
      lastTickAtRef.current = now;
      const idleMs = now - lastActivityAtRef.current;
      if (idleMs < ACTIVE_IDLE_THRESHOLD_MS) pendingActiveRef.current += deltaSec;
      else pendingStandbyRef.current += deltaSec;
    }
    const tickTimer = setInterval(tick, TICK_INTERVAL_MS);

    function flush(ended: boolean) {
      tick();
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const activeSeconds = Math.round(pendingActiveRef.current);
      const standbySeconds = Math.round(pendingStandbyRef.current);
      if (activeSeconds === 0 && standbySeconds === 0 && !ended) return;
      pendingActiveRef.current = 0;
      pendingStandbyRef.current = 0;
      const payload = JSON.stringify({
        sessionId, context, activeSeconds, standbySeconds, ended,
        matchdealProfileId: matchdealProfileId ?? undefined,
        matchdealKind: matchdealKind ?? undefined,
      });
      if (ended && navigator.sendBeacon) {
        navigator.sendBeacon('/api/usage/heartbeat', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/usage/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: ended }).catch(() => {});
      }
      if (ended) sessionIdRef.current = null;
    }
    const flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        flush(true); // ends THIS session
      } else if (!sessionIdRef.current) {
        newSession(); // resuming from hidden starts a genuinely new one
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    function onBeforeUnload() { flush(true); }
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, markActivity));
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, context, matchdealProfileId, matchdealKind]);
}
