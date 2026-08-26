'use client';
// Prompt 142 Bloco 1 — score THIS startup against the criteria the
// investor already defined (EvaluationToolsPanel's "Scorecard criteria"
// tab). Private judgment, not startup-disclosed data — shown regardless of
// disclosure level, since it's about what the investor thinks, not what
// the startup has shared.
//
// Prompt 388 §C.3 — no longer editable here: this is now the read-only
// weighted-average table, computed from investor_dossier_tab_scores (the
// per-tab "A minha avaliação" blocks, DossierTabScorePanel.tsx) across
// every dossier tab — never a second, independent score entered directly
// on this panel. "um quadro igual ao actual mas não possivel de editar
// manualmente" (Nuno's own words) — same shape, score buttons gone.
import { useEffect, useState } from 'react';
import { TermHint } from '@/components/ui';
import { weightedCriterionValues, overallWeightedAverage, type ScorecardCriterion, type TabScoreRow } from '@/lib/investor-scorecard-summary';

const HELP_TEXT = 'This table is read-only — it\'s the weighted average of what you rated per dossier tab (About, SWOT, '
  + 'Roadmap, etc.), never entered directly here. Weight is relative importance, not a score. A criterion you never rated '
  + 'anywhere is simply left out, not counted as a 0.';

export function ScorecardPanel({ orgId }: { orgId: string }) {
  const [criteria, setCriteria] = useState<ScorecardCriterion[] | null>(null);
  const [rows, setRows] = useState<TabScoreRow[] | null>(null);

  function load() {
    fetch(`/api/portal/scorecard/tab-scores?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      setCriteria(d.criteria ?? []);
      setRows(d.rows ?? []);
    });
  }
  useEffect(() => { load(); }, [orgId]);

  if (criteria === null || rows === null || criteria.length === 0) return null; // no criteria defined yet — nothing to show here

  const values = weightedCriterionValues(criteria, rows);
  const overall = overallWeightedAverage(criteria, rows);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-gray-900">Your scorecard</h2>
          <TermHint text={HELP_TEXT} />
        </div>
        {overall != null && <span className="text-sm font-semibold text-[#0E7490]">{overall.toFixed(1)} / 10</span>}
      </div>
      <p className="mt-0.5 text-xs text-gray-400">Private to you — never shown to the startup.</p>
      <ul className="mt-2 space-y-1.5">
        {values.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-gray-700">{v.label}</span>
            <span className={`font-medium ${v.value != null ? 'text-gray-800' : 'text-gray-300'}`}>
              {v.value != null ? `${v.value.toFixed(1)} / 10` : 'not rated'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
