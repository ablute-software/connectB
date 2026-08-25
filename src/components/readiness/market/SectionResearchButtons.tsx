'use client';
// Prompt 373 §D — "a button per section, cost estimated up front, real cost
// after." There is no pre-call token-estimation anywhere in this codebase
// (confirmed before writing this) — the honest up-front number is the
// average of what THIS section has actually cost across the platform so
// far (research/estimate/route.ts), never a fabricated precise figure.
import { useEffect, useState } from 'react';

const SECTIONS = ['definition', 'sizing', 'growth', 'players', 'rounds', 'trends', 'regulatory'] as const;
type Section = typeof SECTIONS[number];
const SECTION_LABEL: Record<Section, string> = {
  definition: 'Definition & scope', sizing: 'Market size', growth: 'Growth', players: 'Competitors',
  rounds: 'Comparable rounds', trends: 'Trends & drivers', regulatory: 'Regulatory',
};

export function SectionResearchButtons({ onDone }: { onDone: (costEur: number | null) => void }) {
  const [estimates, setEstimates] = useState<Record<string, { estimateEur: number; basedOnRuns: number }>>({});
  const [running, setRunning] = useState<Section | null>(null);

  useEffect(() => {
    SECTIONS.forEach((s) => {
      fetch(`/api/market-data/research/estimate?section=${s}`).then((r) => r.json())
        .then((body) => setEstimates((prev) => ({ ...prev, [s]: body }))).catch(() => {});
    });
  }, []);

  async function run(section: Section, force: boolean) {
    setRunning(section);
    try {
      const res = await fetch(`/api/market-data/research?section=${section}${force ? '&force=1' : ''}`);
      const body = await res.json();
      onDone(body.costEur ?? null);
    } finally { setRunning(null); }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => {
        const est = estimates[s];
        return (
          <button key={s} disabled={running !== null} onClick={() => run(s, true)}
            title={est ? (est.basedOnRuns > 0 ? `Usually costs ≈ €${est.estimateEur.toFixed(3)}` : `Estimated ≈ €${est.estimateEur.toFixed(2)} (no history yet)`) : undefined}
            className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
            {running === s ? 'Researching…' : SECTION_LABEL[s]}
            {est && <span className="ml-1 text-[10px] text-gray-400">≈€{est.estimateEur.toFixed(3)}</span>}
          </button>
        );
      })}
    </div>
  );
}
