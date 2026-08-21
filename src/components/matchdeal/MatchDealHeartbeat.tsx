'use client';
// Prompt 295 §1 — MatchDeal side of the heartbeat foundation. Own
// self-check (same /api/matchdeal/pairing/self + device id pair/page.tsx
// already uses for its own UI) rather than threading ownProfileId down
// from that page — keeps this component mountable independently in
// pair/layout.tsx without coupling to that page's internal state.
// Silent no-op (never a visible error) if the self-check fails or
// resolves to no profile at all — most visits to /pair are the launch
// gate/pairing flow itself, before any real MatchDeal identity exists.
import { useEffect, useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/matchdeal-device-id';
import { useUsageHeartbeat } from '@/lib/use-usage-heartbeat';

export function MatchDealHeartbeat() {
  const [self, setSelf] = useState<{ kind: 'startup' | 'investor'; ownProfileId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matchdeal/pairing/self?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok && body.kind && body.ownProfileId) setSelf({ kind: body.kind, ownProfileId: body.ownProfileId });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useUsageHeartbeat({
    context: 'matchdeal',
    enabled: !!self,
    matchdealProfileId: self?.ownProfileId ?? null,
    matchdealKind: self?.kind ?? null,
  });

  return null;
}
