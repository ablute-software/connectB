'use client';
// Prompt 124 C2 — one hook, called from each of the 6 key activation-funnel
// routes, so the sensor is defined once (13.2's own rule: never re-derive
// the same indicator per page). Fire-and-forget: a page view is never
// blocked or slowed by this, and any failure (network, pre-migration
// no-op) is silently swallowed — it's telemetry, not a user-facing feature.
import { useEffect } from 'react';
import { authEnabled } from './supabase';

export function useTrackPageView(route: string): void {
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/events/page-view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
}
