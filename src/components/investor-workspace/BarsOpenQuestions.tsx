'use client';
// Prompt 412 §D — "Open questions": crossAxisContradictions' output,
// each item clickable to jump to the axis involved. Empty state is a
// single line, never a giant empty card (lesson 396 §4 — the pattern this
// codebase already established for exactly this shape of "nothing to
// show yet").
import type { BarsAxis } from '@/lib/bars-types';
import { axisOfQuestionId, type CrossAxisContradiction } from '@/lib/bars-scoring';

export function BarsOpenQuestions({ contradictions, onNavigate }: {
  contradictions: CrossAxisContradiction[]; onNavigate: (axis: BarsAxis) => void;
}) {
  if (contradictions.length === 0) {
    return <p className="text-xs text-gray-400">No cross-axis contradictions detected.</p>;
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500">Open questions</h3>
      <ul className="mt-1.5 space-y-1.5">
        {contradictions.map((c) => (
          <li key={c.ruleId}>
            <button onClick={() => onNavigate(axisOfQuestionId(c.involved[0]))}
              className="block w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-left text-xs text-amber-900 hover:border-amber-300">
              {c.question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
