'use client';
// Prompt 922 (I3) — "My evaluations": the applications assigned to the person, call by call. For each call the next deadline and how many remain; for each application where it stands — Not started, In progress,
// Submitted (with the grade) — and a button to open it. The server decides what is theirs; a person with nothing assigned is told what to expect instead of seeing an empty box.
import { useCallback, useEffect, useState } from 'react';
import { formatDayInZone } from '@/lib/calls/tz';
import type { EvalState, MineCall } from '@/lib/calls/eval-store';
import { callsApi } from './api';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const STATE: Record<EvalState, { label: string; tone: string }> = {
  not_started: { label: 'Not started', tone: 'bg-gray-100 text-gray-700' },
  in_progress: { label: 'In progress', tone: 'bg-amber-50 text-amber-900' },
  submitted: { label: 'Submitted', tone: 'bg-emerald-50 text-emerald-900' },
};

/** `callId`: only that call's applications (inside the call's Evaluation tab); without it, every call of the person (the entity's workspace). */
export function MyEvaluations({ onOpen, onCount, callId }: { onOpen: (callId: string, applicationId: string) => void; onCount?: (remaining: number) => void; callId?: string }) {
  const [calls, setCalls] = useState<MineCall[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await callsApi.myEvaluations();
    if (!r.ok) { setError(r.body.error ?? 'Could not load your evaluations.'); return; }
    const mine = callId ? r.body.calls.filter((c) => c.callId === callId) : r.body.calls;
    setError(''); setCalls(mine); onCount?.(mine.reduce((n, c) => n + c.remaining, 0));
  }, [onCount, callId]);
  useEffect(() => { void load(); }, [load]);

  if (!calls) return <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="mine-loading" role={error ? 'alert' : undefined}>{error || 'Loading your evaluations…'}</p>;
  return (
    <section className="min-w-0 space-y-4" aria-label="My evaluations" data-testid="my-evaluations">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">My evaluations</h2>
        <p className="text-xs text-gray-600">The applications assigned to you. Your changes are saved by themselves.</p>
      </div>
      {calls.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600" data-testid="mine-empty">Nothing is assigned to you yet. When applications are assigned to you, they appear here and you get an email.</p>}
      {calls.map((c) => (
        <article key={c.callId} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="mine-call">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{c.callName}</h3>
            {c.deadline && <span className={`text-xs font-medium ${c.deadline.daysLeft <= 1 && c.remaining > 0 ? 'text-[#B00000]' : 'text-gray-600'}`} data-testid="mine-deadline">Deadline {formatDayInZone(`${c.deadline.day}T12:00:00Z`, c.timezone)}{c.remaining > 0 ? (c.deadline.daysLeft < 0 ? ' · passed' : c.deadline.daysLeft === 0 ? ' · today' : ` · ${c.deadline.daysLeft} day${c.deadline.daysLeft === 1 ? '' : 's'} left`) : ''}</span>}
          </div>
          <p className="mt-0.5 text-xs text-gray-600" data-testid="mine-progress">{c.submitted} of {c.total} submitted · {c.remaining === 0 ? 'nothing left to do' : `${c.remaining} remaining`}{c.blind ? ' · blind evaluation' : ''}</p>
          {c.closed && <p className="mt-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">The evaluation is closed.</p>}
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {c.items.map((i) => (
              <li key={i.applicationId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2" data-testid="mine-item">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">{i.reference ?? 'Application'}{i.startupName ? ` · ${i.startupName}` : ''}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-medium ${STATE[i.state].tone}`} data-testid="mine-state">{STATE[i.state].label}</span>{i.state === 'submitted' && i.gradePercent !== null && <span className="text-gray-600">{i.gradePercent} %</span>}</p>
                </div>
                <button type="button" className={BTN} data-testid="mine-open" onClick={() => onOpen(c.callId, i.applicationId)}>{i.state === 'submitted' ? 'View' : i.state === 'in_progress' ? 'Continue' : 'Start'}</button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
