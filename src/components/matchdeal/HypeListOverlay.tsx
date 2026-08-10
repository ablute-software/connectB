'use client';
// Prompt 143 — Hype List v1. Investor-only discovery surface: startups
// matchdeal_startup_hype (v1, live since migration 0053) currently flags
// is_hype=true, within this investor's own eligible pipeline
// (/api/matchdeal/hype). Deliberately v1 only — no new schema, no score
// shown, only the fire badge, per the doc's own instruction not to expose
// the raw internal number.
import { useEffect, useState } from 'react';

interface HypeStartup { orgId: string; name: string | null; sectors: string[]; stage: string | null; country: string | null; photoUrl: string | null }

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

export function HypeListOverlay({ onClose }: { onClose: () => void }) {
  const [startups, setStartups] = useState<HypeStartup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/matchdeal/hype').then((r) => r.json()).then((d) => { if (!cancelled) setStartups(d.startups ?? []); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div role="dialog" aria-label="Hype List" className="absolute inset-0 z-20 flex flex-col bg-[#0B1220]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 className="text-[17px] font-bold text-white">🔥 Hype List</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-[18px] text-white/60 hover:text-white">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {startups === null ? (
          <p className="text-[13px] text-white/50">Loading…</p>
        ) : startups.length === 0 ? (
          <p className="text-[13px] text-white/50">No startups are trending right now — check back soon.</p>
        ) : (
          <ul className="space-y-2.5">
            {startups.map((s) => (
              <li key={s.orgId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[13px] font-bold text-white">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (s.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">{s.name ?? 'A startup'} <span title="Hype">🔥</span></p>
                  <p className="truncate text-[12px] text-white/50">
                    {[s.stage ? (STAGE_LABELS[s.stage] ?? s.stage) : null, s.country, s.sectors[0]].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
