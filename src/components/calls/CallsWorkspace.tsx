'use client';
// Prompt 905 — the Calls area inside an entity's workspace: the list, and the editor of one call. Mounted by the
// investor workspace and the ecosystem workspace when the Calls tab is selected.
// Prompt 922 (I3): a person who has applications assigned to evaluate also gets "My evaluations" here — every call, one list — and the evaluation screen, without having to open the call.
import { useEffect, useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { callsApi } from './api';
import { CallEditor } from './CallEditor';
import { CallsList } from './CallsList';
import { EvaluationScreen } from './EvaluationScreen';
import { MyEvaluations } from './MyEvaluations';
import { ScrollTabs } from '@/components/ScrollTabs';

export function CallsWorkspace({ kind }: { kind: PromoterKind }) {
  // `importFirst`: the call was just created "from documents", so the editor opens on the import dialog.
  // `runId`: open on THAT proposal's review (from a notice or the call's card), not on the upload form.
  const [open, setOpen] = useState<{ id: string; importFirst: boolean; runId: string | null } | null>(null);
  const [view, setView] = useState<'calls' | 'evaluations'>('calls');
  const [evaluating, setEvaluating] = useState<{ callId: string; applicationId: string } | null>(null);
  const [mine, setMine] = useState(0);
  // A link names the call to open (?call=<id>, and where in it: section/step, or an old ?tab=): the editor reads the rest from the address. Only for a well-formed id.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('call');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpen((o) => o ?? { id, importFirst: false, runId: null });
  }, []);
  useEffect(() => { void callsApi.myEvaluations().then((r) => { if (r.ok) setMine(r.body.remaining ?? 0); }); }, [evaluating]);

  if (evaluating) return <EvaluationScreen key={evaluating.applicationId} callId={evaluating.callId} applicationId={evaluating.applicationId} onBack={() => setEvaluating(null)} />;
  if (open) return <CallEditor key={open.id} callId={open.id} startImport={open.importFirst} startRunId={open.runId} onBack={() => setOpen(null)} />;
  return (
    <div className="min-w-0">
      {(mine > 0 || view === 'evaluations') && (
        <ScrollTabs label="Calls or my evaluations" className="mb-4 flex gap-1 border-b border-gray-200" testId="calls-views">
          <button type="button" role="tab" aria-selected={view === 'calls'} data-testid="view-calls" onClick={() => setView('calls')} className={`-mb-px min-h-[44px] border-b-2 px-4 py-2 text-sm ${view === 'calls' ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>Calls</button>
          <button type="button" role="tab" aria-selected={view === 'evaluations'} data-testid="view-evaluations" onClick={() => setView('evaluations')} className={`-mb-px min-h-[44px] border-b-2 px-4 py-2 text-sm ${view === 'evaluations' ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>My evaluations{mine > 0 ? ` (${mine})` : ''}</button>
        </ScrollTabs>
      )}
      {view === 'evaluations'
        ? <MyEvaluations onOpen={(callId, applicationId) => setEvaluating({ callId, applicationId })} onCount={setMine} />
        : <CallsList kind={kind} onOpen={(id, opts) => setOpen({ id, importFirst: opts?.importFirst === true, runId: opts?.runId ?? null })} />}
    </div>
  );
}
