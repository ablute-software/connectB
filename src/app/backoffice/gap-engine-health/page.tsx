'use client';
// Prompt 358 Phase 3.3 — "é como saberemos que a vulnerabilidade está
// fechada, com números." Real counts from GET /api/backoffice/gap-engine-
// health (gap_reconciliations + gap_questions, migration 0235) — no
// illustrative placeholders.
import { useEffect, useState } from 'react';

interface HealthData {
  resolvedByReconciliation: number;
  resolvedByQuestion: number;
  reconciliationSuggestedPending: number;
  reconciliationUncovered: number;
  reconciliationDismissed: number;
  repeatedQuestionCount: number;
  midSessionAbandonment: number | null;
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}

export default function GapEngineHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/gap-engine-health').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setData(body);
    }).catch(() => setErr('not available'));
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900">Gap-interrogation engine health</h1>
      <p className="mt-1 text-sm text-gray-500">
        Prompt 358&apos;s own bar: is the founder-question vulnerability actually closed, in numbers — never a proxy.
      </p>

      {err && <p className="mt-4 text-sm text-amber-700">{err === 'not available yet' ? 'Migration pending — no data yet.' : err}</p>}

      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Kpi label="Gaps resolved by reconciliation (auto-linked, no question asked)" value={data.resolvedByReconciliation} accent="#0E7490" />
            <Kpi label="Gaps resolved by a question to the founder" value={data.resolvedByQuestion} accent="#7c3aed" />
            <Kpi label="Repeated-question count (must be 0 — DB-enforced)" value={data.repeatedQuestionCount} accent={data.repeatedQuestionCount === 0 ? '#16a34a' : '#B00000'} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Kpi label="Reconciliation matches awaiting founder confirmation" value={data.reconciliationSuggestedPending} accent="#d97706" />
            <Kpi label="Reconciliation found nothing (a real question is fair here)" value={data.reconciliationUncovered} accent="#64748b" />
            <Kpi label="Founder dismissed a suggested match" value={data.reconciliationDismissed} accent="#64748b" />
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">Mid-session abandonment</p>
            <p className="mt-1 text-xs text-gray-500">
              Not measurable yet — the ledger records answered questions, not shown-but-unanswered ones. Adding a
              question-SHOWN event is the honest next step here, not a fabricated number in its place.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
