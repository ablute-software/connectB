'use client';
// Prompt 142 Bloco 1 — score THIS startup against the criteria the
// investor already defined. Private judgment, not startup-disclosed data —
// shown regardless of disclosure level, since it's about what the investor
// thinks, not what the startup has shared.
//
// Prompt 388 §C.3 — two tables in the same panel, top to bottom: Tabela 1
// (weight/importance, editable — drag one criterion, the others compensate)
// then Tabela 2 (the weighted average, read-only, computed from
// investor_dossier_tab_scores — the per-tab "My evaluation" blocks,
// DossierTabScorePanel.tsx). "um quadro igual ao actual mas não possivel de
// editar manualmente... no fim do painel 'Your scorecard' (por baixo da
// Tabela 1 de pesos)" — Nuno's own words, verbatim.
//
// Prompt 390 §1 — Tabela 1 was originally built inside EvaluationToolsPanel
// (a top-level tab with nothing to do with a specific startup) instead of
// here, where 388 §C.3 actually asked for it. ScorecardWeightsEditor.tsx is
// the same component, extracted, mounted in BOTH places now — not a second
// copy of the drag logic.
import { useEffect, useState } from 'react';
import { TermHint } from '@/components/ui';
import { ScorecardWeightsEditor } from './ScorecardWeightsEditor';
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

  const hasCriteria = (criteria?.length ?? 0) > 0;
  const values = hasCriteria ? weightedCriterionValues(criteria!, rows!) : [];
  const overall = hasCriteria ? overallWeightedAverage(criteria!, rows!) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {/* Prompt 395 — "Your scorecard" belongs to Tabela 2 (below), not this
          panel as a whole: it used to sit here, at the very top, reading as
          the title of Tabela 1 (Relative importance) right underneath it —
          the opposite of what 393 §2 asked for. This subtitle is the only
          thing left at the panel level, since it genuinely applies to both
          tables. */}
      <p className="text-xs text-gray-400">Private to you — never shown to the startup.</p>

      {/* Tabela 1 — always here, even with zero criteria yet: this is the
          only place a first criterion gets created. Its own fetch is
          independent of the tab-scores one above (a small duplicate read,
          accepted for reusing the component as-is rather than re-plumbing
          shared state across two different data shapes). Its own title
          ("Relative importance") lives inside ScorecardWeightsEditor. */}
      <div className="mt-3">
        <ScorecardWeightsEditor onChanged={load} />
      </div>

      {/* Tabela 2 — read-only, only once there's something to show; a
          criterion that exists but was never scored anywhere still shows as
          "not rated", never silently absent. "Your scorecard" is ITS title,
          not the panel's. */}
      {hasCriteria && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-gray-900">Your scorecard</h2>
              <TermHint text={HELP_TEXT} />
            </div>
            {overall != null && <span className="text-sm font-semibold text-[#0E7490]">{overall.toFixed(1)} / 10</span>}
          </div>
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
      )}
    </div>
  );
}
