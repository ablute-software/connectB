'use client';
// Prompt 922 (I3) — the Evaluation tab of a call: for whoever has applications assigned, "My evaluations" of THIS call and the evaluation screen; the administrators' board comes with the consolidation (I4).
import { useState } from 'react';
import { EvaluationScreen } from './EvaluationScreen';
import { MyEvaluations } from './MyEvaluations';

export function EvaluationTab({ callId }: { callId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="min-w-0" data-testid="evaluation-tab">
      {open
        ? <EvaluationScreen key={open} callId={callId} applicationId={open} onBack={() => setOpen(null)} />
        : <MyEvaluations callId={callId} onOpen={(_c, a) => setOpen(a)} />}
    </div>
  );
}
