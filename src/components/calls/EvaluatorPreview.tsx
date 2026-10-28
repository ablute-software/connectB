'use client';
// Prompt 922 (I1) — "As the evaluator will see it": the grid with the weights, the scale as buttons side by side (never typing numbers), the description of the level on hover or selection, "Add comment", the
// final grade in a ring that shows N/A until every criterion has a score, the formula in words and the examples worked out. Nothing is saved here: it is a rehearsal (the screen of the evaluators, I3, uses
// the same pieces).
import { useMemo, useState } from 'react';
import { exampleGrades, formulaText, gradeText, levelDescription, scaleLabel, scaleLevels, weightedGrade, belowMinimum, type Criterion } from '@/lib/calls/eval-grid';

export function GradeRing({ percent, label }: { percent: number | null; label: string }) {
  const r = 34; const c = 2 * Math.PI * r;
  const [main, sub] = label.split(/ (?=\()/);
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`Final grade: ${label}`} data-testid="grade-ring">
      <svg viewBox="0 0 80 80" className="h-28 w-28 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="#0E7490" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - filled / 100)} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center font-bold leading-tight text-gray-900" data-testid="grade-ring-text"><span className="text-sm">{main}</span>{sub && <span className="text-[11px] font-medium text-gray-600">{sub}</span>}</span>
    </div>
  );
}

export function EvaluatorPreview({ criteria }: { criteria: Criterion[] }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<{ id: string; level: number } | null>(null);
  const [comments, setComments] = useState<Set<string>>(new Set());
  const grade = useMemo(() => weightedGrade(criteria, scores), [criteria, scores]);
  const flagged = useMemo(() => belowMinimum(criteria, scores), [criteria, scores]);
  if (criteria.length === 0) return <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500" data-testid="preview-empty">Add criteria to see how the evaluators will see the grid.</p>;
  return (
    <div className="min-w-0 space-y-4" data-testid="evaluator-preview">
      <p className="rounded bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">A rehearsal: nothing is saved. Pick a level on each criterion to see the grade.</p>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-3">
        <GradeRing percent={grade.percent} label={gradeText(grade)} />
        <div className="min-w-0 text-sm text-gray-700">
          <p><b>{grade.scored} of {grade.total}</b> criteria scored.</p>
          {grade.percent === null && <p className="text-xs text-gray-500">The grade shows N/A until every criterion has a score.</p>}
          {flagged.length > 0 && <p className="mt-1 text-xs text-amber-900" data-testid="preview-flag">Flagged: {flagged.map((f) => `${f.name} (${f.score} < ${f.min})`).join(', ')}. The application is never excluded automatically.</p>}
        </div>
      </div>
      <ul className="space-y-3">
        {criteria.map((c) => {
          const desc = hover?.id === c.id ? levelDescription(c, hover.level) : scores[c.id] !== undefined ? levelDescription(c, scores[c.id]) : null;
          return (
            <li key={c.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="preview-criterion">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{c.name || 'Untitled criterion'}</p>
                <span className="shrink-0 text-xs text-gray-500">weight {c.weight} % · scale {scaleLabel(c)}</span>
              </div>
              {c.section && <p className="text-[11px] uppercase tracking-wide text-gray-400">{c.section}</p>}
              {c.guidance && <p className="mt-1 text-xs text-gray-600 [overflow-wrap:anywhere]">{c.guidance}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Score for ${c.name}`}>
                {scaleLevels(c).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={scores[c.id] === l} data-testid="preview-level" onMouseEnter={() => setHover({ id: c.id, level: l })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ id: c.id, level: l })} onBlur={() => setHover(null)}
                    onClick={() => setScores((s) => ({ ...s, [c.id]: l }))}
                    className={`min-h-[44px] min-w-[44px] rounded-lg border px-2 text-sm font-semibold ${scores[c.id] === l ? 'border-[#0E7490] bg-[#0E7490] text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>{l}</button>
                ))}
              </div>
              {desc && <p className="mt-1.5 text-xs text-gray-700" data-testid="preview-level-text">{desc}</p>}
              {(c.commentRequired || comments.has(c.id)) ? (
                <p className="mt-1.5 text-xs text-gray-500">{c.commentRequired ? 'A comment is required for this criterion.' : null}</p>
              ) : (
                <button type="button" className="mt-1.5 min-h-[44px] text-xs font-medium text-[#0E7490] hover:underline sm:min-h-0" data-testid="preview-add-comment" onClick={() => setComments((s) => new Set(s).add(c.id))}>Add comment</button>
              )}
            </li>
          );
        })}
      </ul>
      <section className="rounded-lg border border-gray-200 bg-white p-3" data-testid="preview-formula">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">The formula</p>
        <p className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]">{formulaText(criteria)}</p>
        <ul className="mt-2 space-y-0.5 text-xs text-gray-700" data-testid="preview-examples">
          {exampleGrades(criteria).map((e) => <li key={e.label}>{e.label}: <b>{gradeText(e.grade)}</b></li>)}
        </ul>
      </section>
    </div>
  );
}
