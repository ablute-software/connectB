'use client';
// Prompt 922 (I3, I4) — the Evaluation tab of a call. For whoever may see the board (Configure call or Final decision): the board — progress, ranking, flags, decisions, close, export — and, beside it, "My evaluations"
// when applications are assigned to them too. For an evaluator: "My evaluations" of THIS call and the evaluation screen. Opening an application from the board opens it read-only for an administrator.
import { useEffect, useState } from 'react';
import { callsApi } from './api';
import { EvaluationBoard } from './EvaluationBoard';
import { EvaluationScreen } from './EvaluationScreen';
import { MyEvaluations } from './MyEvaluations';
import { ScrollTabs } from '@/components/ScrollTabs';

export function EvaluationTab({ callId }: { callId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [board, setBoard] = useState<boolean | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [view, setView] = useState<'board' | 'mine'>('board');
  useEffect(() => { void callsApi.evaluationBoard(callId).then((r) => setBoard(r.ok)); }, [callId]);
  useEffect(() => { void callsApi.myEvaluations().then((r) => setMine(r.ok ? r.body.calls.filter((c) => c.callId === callId).reduce((n, c) => n + c.total, 0) : 0)); }, [callId, open]);

  if (open) return <EvaluationScreen key={open} callId={callId} applicationId={open} onBack={() => setOpen(null)} />;
  if (board === null || mine === null) return <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="evaluation-tab-loading">Loading…</p>;
  const both = board && mine > 0;
  const showBoard = board && (!both || view === 'board');
  return (
    <div className="min-w-0 space-y-4" data-testid="evaluation-tab">
      {both && (
        <ScrollTabs label="Board or my evaluations" className="flex gap-1 border-b border-gray-200">
          {([['board', 'Board'], ['mine', `My evaluations (${mine})`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`evaluation-view-${k}`} onClick={() => setView(k)} className={`-mb-px min-h-[44px] border-b-2 px-4 py-2 text-sm ${view === k ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{label}</button>
          ))}
        </ScrollTabs>
      )}
      {showBoard ? <EvaluationBoard callId={callId} onOpen={setOpen} /> : <MyEvaluations callId={callId} onOpen={(_c, a) => setOpen(a)} />}
    </div>
  );
}
