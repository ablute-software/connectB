'use client';
// Company tab redesign — "Your profile is X% complete", always visible at
// the top of the Company panel. Clicking scrolls to (and briefly flashes)
// the next missing field, cycling through the full list. At 100% for the
// first time in a session, the bar celebrates once (shimmer + a few
// discrete stars) — pure CSS, no new dependency. The label's persistent
// "100% complete" star (shown on the Company tab itself) is driven by the
// same `pct === 100` the caller already has; this component doesn't own
// that part.
import { useEffect, useRef, useState } from 'react';
import type { CompletenessField } from '@/lib/companyCompleteness';

export function CompletenessBar({ pct, missing, orgId, onFlash }: {
  pct: number; missing: CompletenessField[]; orgId: string; onFlash: (fieldId: string) => void;
}) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const seenPct = useRef<number | null>(null);

  useEffect(() => {
    const key = `sherlockdeal-company-100-celebrated-${orgId}`;
    const firstTimeThisSession = pct === 100 && !sessionStorage.getItem(key);
    // Fires whether 100% was JUST reached (prev < 100) or the page simply
    // loaded already at 100% and this session hasn't seen the celebration
    // yet — "pela primeira vez numa sessão" reads as session-scoped, not
    // "must have just crossed the line this render."
    if (firstTimeThisSession) {
      sessionStorage.setItem(key, '1');
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), 2200);
      return () => clearTimeout(t);
    }
    seenPct.current = pct;
  }, [pct, orgId]);

  function handleClick() {
    if (missing.length === 0) return;
    const field = missing[cycleIndex % missing.length];
    setCycleIndex((i) => i + 1);
    onFlash(field.id);
    document.getElementById(field.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <style>{`
        @keyframes sd-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes sd-star-pop { 0% { opacity: 0; transform: translateY(6px) scale(.6); } 30% { opacity: 1; transform: translateY(-4px) scale(1); } 100% { opacity: 0; transform: translateY(-18px) scale(.8); } }
        .sd-shimmer-sweep { animation: sd-shimmer 1.4s ease-in-out; }
        .sd-star { animation: sd-star-pop 1.6s ease-out forwards; }
      `}</style>

      <div className="flex items-center justify-between gap-2">
        <button onClick={handleClick} disabled={missing.length === 0}
          className={`flex-1 text-left ${missing.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-gray-800">
              Your profile is <span className={pct === 100 ? 'text-amber-600' : 'text-[#0E7490]'}>{pct}%</span> complete
            </span>
            {missing.length > 0 && <span className="text-[11px] text-gray-400">click to jump to what&apos;s missing</span>}
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-amber-400' : 'bg-[#0E7490]'}`} style={{ width: `${pct}%` }} />
          </div>
        </button>
      </div>

      {celebrating && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="sd-shimmer-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-amber-200/50 to-transparent" />
          {[12, 28, 46, 64, 80, 92].map((left, i) => (
            <span key={left} className="sd-star absolute top-2 text-amber-400" style={{ left: `${left}%`, animationDelay: `${i * 90}ms` }}>✦</span>
          ))}
        </div>
      )}
      {celebrating && (
        <p className="relative mt-2 text-xs font-semibold text-amber-700">Congratulations — profile 100% complete.</p>
      )}
    </div>
  );
}
