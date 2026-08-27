'use client';
// Prompt 412 §B.1 — one of the 4 axis cards: the engine's own triple
// (Score/Coverage/Confidence — 411 §C.2's own words: "score e coverage
// nunca aparecem um sem o outro"), compact subscores, an active-cap badge
// when a red flag confirms, and the honest empty state. Score always
// carries the stage-normalized caption (v2 content doc's transversal rule
// 1: "4.3/5 — relative to expected evidence at this stage") — never a
// bare number.
import type { BarsAxis } from '@/lib/bars-types';
import type { AxisResult } from '@/lib/bars-scoring';

const CONFIDENCE_LABEL: Record<'high' | 'moderate' | 'low', string> = {
  high: 'High confidence', moderate: 'Moderate confidence', low: 'Low confidence',
};
const CONFIDENCE_COLOR: Record<'high' | 'moderate' | 'low', string> = {
  high: 'text-emerald-700 bg-emerald-50', moderate: 'text-amber-700 bg-amber-50', low: 'text-gray-500 bg-gray-100',
};

export function BarsAxisCard({ axis, label, result, applicableAtStage, onOpen, notMaterial, onToggleNotMaterial }: {
  axis: BarsAxis; label: string; result: AxisResult | null; applicableAtStage: number;
  onOpen: () => void; notMaterial?: boolean; onToggleNotMaterial?: (notMaterial: boolean) => void;
}) {
  const isNotMaterial = result?.notMaterial ?? notMaterial ?? false;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left text-sm font-semibold text-gray-900 hover:text-[#0E7490]">{label}</button>
        {axis === 'technology' && onToggleNotMaterial && (
          <label className="flex items-center gap-1 text-[10px] text-gray-400" title="Mark this when technology isn't a material source of advantage for this company (e.g. an excellent marketplace on a commodity stack) — this never lowers the overall assessment; that strength shows up on other axes instead.">
            <input type="checkbox" checked={isNotMaterial} onChange={(e) => onToggleNotMaterial(e.target.checked)} className="accent-[#0E7490]" />
            Not material
          </label>
        )}
      </div>

      {isNotMaterial ? (
        <p className="mt-2 text-sm font-medium text-gray-400">Not material (N/A)</p>
      ) : !result || result.answered === 0 ? (
        <button onClick={onOpen} className="mt-2 block text-left text-xs text-gray-400 hover:text-[#0E7490]">
          Not started · {applicableAtStage} question{applicableAtStage === 1 ? '' : 's'} apply at this stage
        </button>
      ) : (
        <button onClick={onOpen} className="mt-2 block w-full text-left">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold text-[#0E7490]">{result.score != null ? result.score.toFixed(1) : '—'}/5</span>
            {result.capApplied && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-[#B00000]">
                Capped at {result.capApplied.capLevel}/5
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400">relative to expected evidence at this stage</p>

          <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-600">
            <span>{Math.round((result.coverage ?? 0) * 100)}% coverage</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR[result.confidenceBand ?? 'low']}`}>
              {CONFIDENCE_LABEL[result.confidenceBand ?? 'low']}
            </span>
          </div>

          {Object.keys(result.subscores).length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {Object.entries(result.subscores).map(([sub, score]) => (
                <div key={sub} className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>{sub}</span>
                  <span>{score != null ? score.toFixed(1) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </button>
      )}
    </div>
  );
}
