'use client';
// Prompt 85 Correction 2 — the explanatory panel "First steps X/4" opens
// instead of navigating straight off the page. The 4 milestones themselves
// are NOT redefined here — they're read from useW1Milestones() (W1Badge.tsx),
// the one existing definition; this component only adds explanation/state/
// action UI around them. Read-only: opening or closing never marks anything
// complete or fires any request — every milestone's `done` is recomputed
// live from `db` on every render, same as the badge itself.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useW1Milestones } from './W1Badge';

const EXPLANATIONS: Record<string, string> = {
  profile: 'Fill in your sector, stage, and round target so investors (and the platform) know what you’re raising.',
  pipeline: 'Get your first investor into the Pipeline — assigned from the catalog, or imported yourself.',
  outreach: 'Log your first outreach — a call, email, or meeting — with an investor.',
  dataroom: 'Upload at least one document to your Data Room so investors have something to review.',
};

export function FirstStepsPanel({ onClose }: { onClose: () => void }) {
  const milestones = useW1Milestones();
  const router = useRouter();
  const doneCount = milestones.filter((m) => m.done).length;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="first-steps-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="first-steps-title" className="text-base font-semibold text-gray-800">
            First steps {doneCount}/{milestones.length}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <p className="mt-1 text-xs text-gray-400">Four things worth doing in your first week.</p>

        <ul className="mt-3 space-y-2.5">
          {milestones.map((m) => (
            <li key={m.key} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    m.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {m.done ? '✓' : ''}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{m.label}</div>
                    <p className="mt-0.5 text-xs text-gray-500">{EXPLANATIONS[m.key]}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  m.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {m.done ? 'Completed' : 'Not started'}
                </span>
              </div>
              {!m.done && (
                <button onClick={() => { onClose(); router.push(m.href); }}
                  className="mt-2 rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                  {m.key === 'profile' ? 'Complete profile' : m.key === 'pipeline' ? 'Open Pipeline' : m.key === 'outreach' ? 'Log an interaction' : 'Open Data Room'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
