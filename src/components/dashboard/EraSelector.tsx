'use client';
// Prompt 361 — the segmented "All history / Before Sherlock / With
// Sherlock" selector shown once at the top of the Dashboard, applying to
// the funnel/status-breakdown/pass-reasons/data-room-engagement cards
// below it. Persisted per-org in localStorage, same load/save-effect shape
// as the dataroom folder-collapse state (documents/page.tsx) — key falls
// back to 'demo' when org id is unset, writes wrapped in try/catch for
// quota/private-mode, and a `loaded` guard against writing the default
// back before the real value is read.
import { useEffect, useState } from 'react';
import type { EraFilter } from '@/lib/dashboard-era';
import { eraContext } from '@/lib/dashboard-era';

const OPTIONS: { key: EraFilter; label: string }[] = [
  { key: 'all', label: 'All history' },
  { key: 'before', label: 'Before Sherlock' },
  { key: 'platform', label: 'With Sherlock' },
];

export function useEraFilter(orgId: string | undefined): [EraFilter, (f: EraFilter) => void] {
  const key = `dashboard-era-${orgId || 'demo'}`;
  const [era, setEra] = useState<EraFilter>('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === 'all' || raw === 'before' || raw === 'platform') setEra(raw);
    } catch { /* ignore — falls back to 'all' */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, era); } catch { /* quota / private mode */ }
  }, [era, key, loaded]);

  return [era, setEra];
}

export function EraSelector({ era, onChange, joinedAt }: { era: EraFilter; onChange: (f: EraFilter) => void; joinedAt: string | null | undefined }) {
  const ctx = eraContext(era, joinedAt, new Date());
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex gap-1">
        {OPTIONS.map((o) => (
          <button key={o.key} onClick={() => onChange(o.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              era === o.key ? 'bg-[#0E7490] text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {ctx && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">{ctx.label}</span> — {ctx.detail}
        </p>
      )}
    </div>
  );
}
