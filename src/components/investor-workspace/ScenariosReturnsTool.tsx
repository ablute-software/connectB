'use client';
// Prompt 169 §C — Return scenario (MOIC), evolved by Prompt 408 §A.3 into
// "Scenarios & returns": up to 5 named, weighted exit scenarios (Failure→
// Outlier) instead of a single assumed exit, probability-weighted MOIC/IRR/
// expected value, and the VC Method's own inversion (target multiple ->
// required exit). All the actual math is dilution.ts (ownership/capital,
// including the new option-pool/pro-rata mechanics) and scenario-returns.ts
// (XIRR, aggregation, required exit) — this file is rendering + input
// wiring only, never a second copy of either.
//
// Shared with the Ownership calculator (EvaluationToolsPanel's own state,
// 405 §B.2): startup selection, ticket, basis, futureDilutions (the plain
// per-round % — still what the Ownership calculator uses). The option
// pool/pro-rata/round-valuation/timing inputs below are this tool's OWN,
// local "advanced controls, collapsed" (408 §A.3.1) — the Ownership
// calculator has no use for them, so they don't pollute the shared state.
//
// Same permanent private-judgment disclaimer the Berkus tool itself
// carries — every number here is arithmetic over the investor's own
// assumptions, never a platform-endorsed forecast.
import { useEffect, useState } from 'react';
import { computeDilution, type FutureRoundInput, type ValuationBasis } from '@/lib/dilution';
import { computeRequiredExit, computeScenarioReturns, type ScenarioInput, type ScenarioOwnership } from '@/lib/scenario-returns';

interface PipelineCard {
  orgId: string; name: string; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: ValuationBasis | null;
}

const PRESET_MULTIPLES = [3, 5, 10] as const;
const MAX_SCENARIOS = 5;
// Prompt 408 §A.2.1 — up to 5 named presets; Failure defaults to exit=0
// (a real, expected outcome to model, not an oversight).
const SCENARIO_PRESETS = ['Failure', 'Downside', 'Base', 'Upside', 'Outlier'] as const;

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

interface ScenarioDraft { label: string; probabilityPct: string; exitValueEur: string; horizonYears: string }
function defaultScenarioDrafts(): ScenarioDraft[] {
  return [
    { label: 'Base', probabilityPct: '60', exitValueEur: '20000000', horizonYears: '5' },
    { label: 'Outlier', probabilityPct: '20', exitValueEur: '50000000', horizonYears: '7' },
    { label: 'Failure', probabilityPct: '20', exitValueEur: '0', horizonYears: '3' },
  ];
}

interface RoundAdvancedDraft { optionPoolExpansionPct: string; participateProRata: boolean; roundValuationEur: string; yearsFromNow: string }
function emptyRoundAdvanced(): RoundAdvancedDraft {
  return { optionPoolExpansionPct: '', participateProRata: false, roundValuationEur: '', yearsFromNow: '' };
}

export function ScenariosReturnsTool({ cards, selectedOrgId, ticket, setTicket, basis, setBasis, futureDilutions, setFutureDilutions, onSwitchToSimulator }: {
  cards: PipelineCard[]; selectedOrgId: string;
  ticket: string; setTicket: (v: string) => void;
  basis: ValuationBasis; setBasis: (v: ValuationBasis) => void;
  futureDilutions: string[]; setFutureDilutions: (v: string[]) => void;
  onSwitchToSimulator: () => void;
}) {
  // Prompt 408 §A.3.4 — unlike the Ownership calculator, this tool works
  // WITHOUT a startup selection: hypothetical mode, same framing as the
  // Equity simulator ("your own numbers"). Its own local valuation/round
  // fields, only used when nothing real is selected.
  const [hypoValuation, setHypoValuation] = useState('5000000');
  const [hypoRoundTarget, setHypoRoundTarget] = useState('1000000');

  const [exitMode, setExitMode] = useState<'berkus' | 'manual'>('berkus');
  const [berkusTotal, setBerkusTotal] = useState<number | null>(null);
  const [berkusLoading, setBerkusLoading] = useState(false);
  const [berkusMultiple, setBerkusMultiple] = useState<number>(5);

  const [scenarios, setScenarios] = useState<ScenarioDraft[]>(defaultScenarioDrafts);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [roundAdvanced, setRoundAdvanced] = useState<RoundAdvancedDraft[]>(() => futureDilutions.map(emptyRoundAdvanced));
  const [targetMultiple, setTargetMultiple] = useState('10');

  const selected = cards.find((c) => c.orgId === selectedOrgId) ?? null;
  const hypothetical = !selected;

  useEffect(() => {
    setBasis(selected?.roundValuationBasis ?? 'pre_money');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId]);

  useEffect(() => {
    if (!selectedOrgId) { setBerkusTotal(null); return; }
    setBerkusLoading(true);
    fetch(`/api/portal/berkus?orgId=${encodeURIComponent(selectedOrgId)}`).then((r) => r.json())
      .then((d) => {
        const e = d.estimate as { sound_idea_eur: number; prototype_eur: number; team_eur: number; relationships_eur: number; sales_eur: number } | null;
        setBerkusTotal(e ? e.sound_idea_eur + e.prototype_eur + e.team_eur + e.relationships_eur + e.sales_eur : null);
      })
      .catch(() => setBerkusTotal(null))
      .finally(() => setBerkusLoading(false));
  }, [selectedOrgId]);

  // Keeps roundAdvanced aligned 1:1 with futureDilutions (the shared round
  // count) whenever it changes, without discarding what's already there.
  useEffect(() => {
    setRoundAdvanced((prev) => futureDilutions.map((_, i) => prev[i] ?? emptyRoundAdvanced()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [futureDilutions.length]);

  function updateScenario(i: number, patch: Partial<ScenarioDraft>) {
    setScenarios((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function addScenario(label: string) {
    setScenarios((prev) => (prev.length >= MAX_SCENARIOS ? prev : [...prev, { label, probabilityPct: '0', exitValueEur: '0', horizonYears: '5' }]));
  }
  function removeScenario(i: number) {
    setScenarios((prev) => prev.filter((_, j) => j !== i));
  }
  function updateRoundAdvanced(i: number, patch: Partial<RoundAdvancedDraft>) {
    setRoundAdvanced((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function fillBaseFromBerkus() {
    if (berkusTotal == null) return;
    const idx = scenarios.findIndex((s) => s.label === 'Base');
    const exitValueEur = String(berkusTotal * berkusMultiple);
    if (idx >= 0) updateScenario(idx, { exitValueEur }); else setScenarios((prev) => [...prev, { label: 'Base', probabilityPct: '0', exitValueEur, horizonYears: '5' }]);
  }

  if (!hypothetical && selected!.roundValuationEur == null) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Your own assumptions — private, not investment advice.
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>No valuation on file for {selected!.name}&apos;s round yet — Scenarios &amp; returns needs real round data to compute your ownership %.</p>
          <button onClick={onSwitchToSimulator} className="mt-2 font-medium text-[#0E7490] hover:underline">
            Switch to the Equity simulator to model your own assumptions →
          </button>
        </div>
      </div>
    );
  }

  const roundValuationEur = hypothetical ? Number(hypoValuation) || 0 : selected!.roundValuationEur!;
  const roundTargetEur = hypothetical ? Number(hypoRoundTarget) || 0 : selected!.roundTargetEur ?? 0;
  const ticketEur = Number(ticket) || 0;

  const futureRounds: FutureRoundInput[] = futureDilutions.map((d, i) => {
    const adv = roundAdvanced[i] ?? emptyRoundAdvanced();
    return {
      dilutionPct: Number(d) || 0,
      optionPoolExpansionPct: adv.optionPoolExpansionPct ? Number(adv.optionPoolExpansionPct) || 0 : undefined,
      participateProRata: adv.participateProRata,
      roundValuationEur: adv.roundValuationEur ? Number(adv.roundValuationEur) || undefined : undefined,
      yearsFromNow: adv.yearsFromNow ? Number(adv.yearsFromNow) || undefined : undefined,
    };
  });
  const dilution = computeDilution({
    ticketEur, roundValuationEur, roundTargetEur, valuationBasis: basis, futureRoundDilutionsPct: [], futureRounds,
  });
  const ownershipAtExitPct = dilution.ownershipAfterFutureRoundsPct.length > 0
    ? dilution.ownershipAfterFutureRoundsPct[dilution.ownershipAfterFutureRoundsPct.length - 1]
    : dilution.ownershipAfterThisRoundPct;
  const totalCapitalInvestedEur = dilution.totalCapitalInvestedEur ?? ticketEur;
  const cashOutflows: ScenarioOwnership['cashOutflows'] = [{ yearsFromNow: 0, amountEur: -ticketEur }];
  futureRounds.forEach((r, i) => {
    if (r.participateProRata && r.roundValuationEur != null && dilution.proRataStatusByRound?.[i] === 'applied') {
      const ownAtThatPoint = dilution.ownershipAfterFutureRoundsPct[i - 1] ?? dilution.ownershipAfterThisRoundPct;
      cashOutflows.push({ yearsFromNow: r.yearsFromNow ?? 0, amountEur: -(ownAtThatPoint / 100) * r.roundValuationEur });
    }
  });
  const ownership: ScenarioOwnership = { ownershipAtExitPct, totalCapitalInvestedEur, cashOutflows };

  const scenarioInputs: ScenarioInput[] = scenarios.map((s) => ({
    label: s.label, probabilityPct: Number(s.probabilityPct) || 0, exitValueEur: Number(s.exitValueEur) || 0, horizonYears: Number(s.horizonYears) || 0,
  }));
  const { scenarios: results, aggregate } = computeScenarioReturns(scenarioInputs, ownership);
  const requiredExitEur = computeRequiredExit(Number(targetMultiple) || 0, ownership);
  const unavailableProRataRounds = (dilution.proRataStatusByRound ?? [])
    .map((status, i) => (status === 'unavailable_no_valuation' ? i + 1 : null)).filter((n): n is number => n !== null);

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Your own assumptions — private, not investment advice.
      </p>

      {hypothetical && (
        <p className="text-xs text-gray-500">
          No startup selected — running in <b>hypothetical mode</b>, same as the Equity simulator: your own valuation and round size below, independent of any real data.
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5">
            Your ticket
            <input type="number" value={ticket} onChange={(e) => setTicket(e.target.value)} className="w-28 rounded border border-gray-300 px-2 py-1" />
          </label>
          {hypothetical ? (
            <>
              <label className="flex items-center gap-1.5">
                Valuation
                <input type="number" value={hypoValuation} onChange={(e) => setHypoValuation(e.target.value)} className="w-32 rounded border border-gray-300 px-2 py-1" />
              </label>
              <label className="flex items-center gap-1.5">
                Round size
                <input type="number" value={hypoRoundTarget} onChange={(e) => setHypoRoundTarget(e.target.value)} className="w-32 rounded border border-gray-300 px-2 py-1" />
              </label>
            </>
          ) : null}
          <label className="flex items-center gap-1.5">
            Valuation is
            <select value={basis} onChange={(e) => setBasis(e.target.value as ValuationBasis)} className="rounded border border-gray-300 px-2 py-1">
              <option value="post_money">post-money</option>
              <option value="pre_money">pre-money</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">
            Hypothetical future rounds — expected dilution per round (%)
            <span className="cursor-help text-gray-400" title="Each box is one future round and how much of your stake you expect it to dilute.">ⓘ</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {futureDilutions.map((d, i) => (
              <input key={i} type="number" value={d}
                onChange={(e) => setFutureDilutions(futureDilutions.map((v, j) => (j === i ? e.target.value : v)))}
                className="w-16 rounded border border-gray-300 px-1.5 py-1 text-sm" />
            ))}
          </div>
        </div>

        <button onClick={() => setAdvancedOpen((v) => !v)} className="mt-3 text-xs font-medium text-[#0E7490] hover:underline">
          {advancedOpen ? 'Hide' : 'Show'} advanced: option pool & pro-rata per round
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-2.5">
            {futureDilutions.map((_, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                <span className="font-medium text-gray-700">Round {i + 1}</span>
                <label className="flex items-center gap-1">
                  Option pool +
                  <input type="number" value={roundAdvanced[i]?.optionPoolExpansionPct ?? ''} placeholder="0"
                    onChange={(e) => updateRoundAdvanced(i, { optionPoolExpansionPct: e.target.value })}
                    className="w-14 rounded border border-gray-300 px-1.5 py-1" />%
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={roundAdvanced[i]?.participateProRata ?? false}
                    onChange={(e) => updateRoundAdvanced(i, { participateProRata: e.target.checked })} />
                  I participate pro-rata
                </label>
                {roundAdvanced[i]?.participateProRata && (
                  <>
                    <label className="flex items-center gap-1">
                      Round post-money
                      <input type="number" value={roundAdvanced[i]?.roundValuationEur ?? ''} placeholder="required"
                        onChange={(e) => updateRoundAdvanced(i, { roundValuationEur: e.target.value })}
                        className="w-28 rounded border border-gray-300 px-1.5 py-1" />
                    </label>
                    <label className="flex items-center gap-1">
                      in
                      <input type="number" value={roundAdvanced[i]?.yearsFromNow ?? ''} placeholder="years"
                        onChange={(e) => updateRoundAdvanced(i, { yearsFromNow: e.target.value })}
                        className="w-14 rounded border border-gray-300 px-1.5 py-1" />
                      yrs
                    </label>
                  </>
                )}
              </div>
            ))}
            {unavailableProRataRounds.length > 0 && (
              <p className="text-[11px] text-amber-700">
                Pro-rata unavailable for round{unavailableProRataRounds.length > 1 ? 's' : ''} {unavailableProRataRounds.join(', ')} — enter that round&apos;s post-money to price it; falling back to plain dilution for now.
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex items-baseline gap-2 border-t border-gray-100 pt-3">
          <span className="text-lg font-semibold text-[#0E7490]">{fmtPct(ownershipAtExitPct / 100)}</span>
          <span className="text-xs text-gray-500">
            ownership at exit · {fmtEur(totalCapitalInvestedEur)} total capital invested{totalCapitalInvestedEur > ticketEur ? ' (ticket + pro-rata)' : ''}
          </span>
        </div>
      </div>

      {!hypothetical && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
          {berkusLoading ? 'Loading your Berkus estimate…' : berkusTotal == null ? (
            <span>No Berkus estimate for {selected!.name} yet — use the Berkus Method tool first to unlock this shortcut.</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>Fill the Base scenario&apos;s exit from your Berkus: {fmtEur(berkusTotal)} ×</span>
              {PRESET_MULTIPLES.map((m) => (
                <button key={m} onClick={() => setBerkusMultiple(m)}
                  className={`rounded-full px-2.5 py-1 font-medium ${berkusMultiple === m ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {m}x
                </button>
              ))}
              <button onClick={fillBaseFromBerkus} className="rounded-full border border-gray-200 px-2.5 py-1 font-medium text-gray-700 hover:border-[#0E7490]">
                Use {fmtEur(berkusTotal * berkusMultiple)}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">Scenarios</div>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_PRESETS.filter((p) => !scenarios.some((s) => s.label === p)).map((p) => (
              <button key={p} onClick={() => addScenario(p)} disabled={scenarios.length >= MAX_SCENARIOS}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-[#0E7490] disabled:opacity-40">
                + {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {scenarios.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-lg border border-gray-100 p-2 text-xs">
              <input value={s.label} onChange={(e) => updateScenario(i, { label: e.target.value })} className="rounded border border-gray-200 px-2 py-1 font-medium text-gray-700" />
              <label className="flex items-center gap-1 text-gray-500">
                <input type="number" value={s.probabilityPct} onChange={(e) => updateScenario(i, { probabilityPct: e.target.value })} className="w-14 rounded border border-gray-300 px-1.5 py-1" />%
              </label>
              <label className="flex items-center gap-1 text-gray-500">
                exit <input type="number" value={s.exitValueEur} onChange={(e) => updateScenario(i, { exitValueEur: e.target.value })} className="w-28 rounded border border-gray-300 px-1.5 py-1" />
              </label>
              <label className="flex items-center gap-1 text-gray-500">
                <input type="number" value={s.horizonYears} onChange={(e) => updateScenario(i, { horizonYears: e.target.value })} className="w-12 rounded border border-gray-300 px-1.5 py-1" />yrs
              </label>
              <button onClick={() => removeScenario(i)} className="justify-self-end text-gray-400 hover:text-[#B00000]">✕</button>
            </div>
          ))}
        </div>

        {!aggregate.probabilitiesValid && (
          <p className="mt-2 text-[11px] font-medium text-amber-700">
            Probabilities sum to {aggregate.probabilitiesSumPct.toFixed(0)}%, not 100% — weighted results below are hidden until they add up.
          </p>
        )}

        {results.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-400">
                  <th className="py-1 pr-2 font-medium">Scenario</th>
                  <th className="py-1 pr-2 font-medium">Proceeds</th>
                  <th className="py-1 pr-2 font-medium">MOIC</th>
                  <th className="py-1 pr-2 font-medium">IRR</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-700">{r.label} <span className="text-gray-400">({r.probabilityPct}%)</span></td>
                    <td className="py-1.5 pr-2 text-gray-700">{fmtEur(r.proceedsEur)}</td>
                    <td className="py-1.5 pr-2 font-medium text-[#0E7490]">{r.moic.toFixed(1)}x</td>
                    <td className="py-1.5 pr-2 text-gray-700">{r.irr == null ? '—' : fmtPct(r.irr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {aggregate.probabilitiesValid && (
              <div className="mt-2 rounded-lg bg-[#E8F4F8] p-2.5 text-sm">
                <span className="font-semibold text-[#0E7490]">
                  {aggregate.weightedMoic!.toFixed(1)}x weighted MOIC · {aggregate.weightedIrr == null ? 'IRR n/a (a scenario has no solvable rate)' : `${fmtPct(aggregate.weightedIrr)} weighted IRR`}
                </span>
                <span className="ml-2 text-xs text-gray-500">expected value {fmtEur(aggregate.expectedValueEur!)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="text-sm font-semibold text-gray-800">Required exit (VC Method)</div>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
          Target return
          <input type="number" value={targetMultiple} onChange={(e) => setTargetMultiple(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-1" />x
        </label>
        {requiredExitEur == null ? (
          <p className="mt-2 text-xs text-gray-400">Set a ticket and ownership above to compute a required exit.</p>
        ) : (
          <p className="mt-2 text-sm text-gray-700">
            This deal needs a <span className="font-semibold text-[#0E7490]">{fmtEur(requiredExitEur)}</span> exit to return {targetMultiple}× after dilution —
            <span className="text-xs text-gray-500"> {fmtPct(ownershipAtExitPct / 100)} ownership × exit = {targetMultiple}× {fmtEur(totalCapitalInvestedEur)} invested</span>
          </p>
        )}
      </div>
    </div>
  );
}
