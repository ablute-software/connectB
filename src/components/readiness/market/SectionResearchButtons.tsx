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
//
// Prompt 384 §C.2 — refactored from "one row of 7 buttons" into a single-
// section component: the Research view now shows one section at a time
// (left menu, right content), so each section's own button lives beside
// ITS OWN outcome banner and pending items, not grouped with the other six.
// The three-outcome contract and the real-cost-history estimate are
// unchanged — only the render shape (one button, not a row) moved.
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

export function SectionResearchButton({ section, onDone }: { section: Section; onDone: (outcome: SectionOutcome) => void }) {
  const [estimate, setEstimate] = useState<{ estimateEur: number; basedOnRuns: number } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setEstimate(null);
    fetch(`/api/market-data/research/estimate?section=${section}`).then((r) => r.json())
      .then((body) => setEstimate(body)).catch(() => {});
  }, [section]);

  async function run() {
    setRunning(true);
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
      setRunning(false);
    }
  }

  return (
    <button disabled={running} onClick={run}
      title={estimate ? (estimate.basedOnRuns > 0 ? `Usually costs ≈ €${estimate.estimateEur.toFixed(3)}` : `Estimated ≈ €${estimate.estimateEur.toFixed(2)} (no history yet)`) : undefined}
      className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
      {running ? 'Researching…' : `Research ${SECTION_LABEL[section]}`}
      {estimate && <span className="ml-1 text-[10px] text-gray-400">≈€{estimate.estimateEur.toFixed(3)}</span>}
    </button>
  );
}

export { SECTIONS, SECTION_LABEL };
export type { Section };
