'use client';
// Prompt 373 §D — "a button per section, cost estimated up front, real cost
// after." There is no pre-call token-estimation anywhere in this codebase
// (confirmed before writing this) — the honest up-front number is the
// average of what THIS section has actually cost across the platform so
// far (research/estimate/route.ts), never a fabricated precise figure.
//
// Prompt 378 §A — the contract is now THREE visible outcomes, never a
// motionless screen. The old version did `await res.json()` with no catch:
// on a Vercel 504 (the §0 root cause) the promise rejected, `finally`
// cleared the spinner, and `onDone` never ran — the founder clicked and
// literally nothing changed. Every path below ends in a state the founder
// can see and act on.
import { useEffect, useState } from 'react';
import { SECTIONS, type Section } from '@/lib/market-research-sections';

const SECTION_LABEL: Record<Section, string> = {
  definition: 'Definition & scope', sizing: 'Market size', growth: 'Growth', players: 'Competitors',
  rounds: 'Comparable rounds', trends: 'Trends & drivers', regulatory: 'Regulatory',
};

export type SectionOutcome =
  | { kind: 'error'; section: Section; message: string }
  | { kind: 'empty'; section: Section; costEur: number | null }
  | { kind: 'found'; section: Section; costEur: number | null; count: number };

export function SectionResearchButtons({ onDone }: { onDone: (outcome: SectionOutcome) => void }) {
  const [estimates, setEstimates] = useState<Record<string, { estimateEur: number; basedOnRuns: number }>>({});
  const [running, setRunning] = useState<Section | null>(null);

  useEffect(() => {
    SECTIONS.forEach((s) => {
      fetch(`/api/market-data/research/estimate?section=${s}`).then((r) => r.json())
        .then((body) => setEstimates((prev) => ({ ...prev, [s]: body }))).catch(() => {});
    });
  }, []);

  async function run(section: Section) {
    setRunning(section);
    try {
      const res = await fetch(`/api/market-data/research?section=${section}&force=1`);
      // A 504/HTML gateway page is NOT json — this is the exact failure the
      // founder hit, and it must surface as words on screen, not a rejected
      // promise nobody catches.
      const body = await res.json().catch(() => null);
      if (!body) {
        onDone({ kind: 'error', section, message: 'The search took too long or failed on the server — try again.' });
        return;
      }
      if (body.ok === false || body.aiError) {
        onDone({ kind: 'error', section, message: body.aiError ?? body.error ?? 'Could not run this search — try again.' });
        return;
      }
      const count = (body.items ?? []).length;
      if (count === 0) onDone({ kind: 'empty', section, costEur: body.costEur ?? null });
      else onDone({ kind: 'found', section, costEur: body.costEur ?? null, count });
    } catch {
      onDone({ kind: 'error', section, message: 'The search couldn\'t reach the server — check your connection and try again.' });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => {
        const est = estimates[s];
        return (
          <button key={s} disabled={running !== null} onClick={() => run(s)}
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

export { SECTION_LABEL };
