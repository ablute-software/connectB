'use client';
// Prompt 169 §C — Return scenario (MOIC). 5th Evaluation tools button.
// Reuses computeDilution (same engine as the Ownership calculator, this
// file's own header comment) for the ownership % half, and this investor's
// own Berkus estimate (or a manually typed exit value) for the exit-value
// half — MOIC = (ownership% × exit value) / ticket. Never a single
// "official" number: when more than one growth multiple is picked, every
// one becomes its own scenario card, same visual pattern as the Equity
// simulator's side-by-side cards. Same permanent private-judgment
// disclaimer the Berkus tool itself carries — this is arithmetic over the
// investor's own assumptions, never a platform-endorsed number.
//
// Prompt 405 §B.2 — startup selection and ticket/basis/futureDilutions are
// now owned by EvaluationToolsPanel and shared with the Ownership
// calculator (same trial values, one investor typing them once). This
// tool no longer has its own startup selector or re-seeds basis itself —
// the panel's own effect does that for both tools together.
import { useEffect, useState } from 'react';
import { computeDilution, type ValuationBasis } from '@/lib/dilution';

interface PipelineCard {
  orgId: string; name: string; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: ValuationBasis | null;
}

const PRESET_MULTIPLES = [3, 5, 10] as const;
const MAX_SCENARIOS = 3;

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

interface ScenarioResult { label: string; exitValueEur: number }

export function ReturnScenarioTool({ cards, selectedOrgId, ticket, setTicket, basis, setBasis, futureDilutions, setFutureDilutions, onSwitchToSimulator }: {
  cards: PipelineCard[]; selectedOrgId: string;
  ticket: string; setTicket: (v: string) => void;
  basis: ValuationBasis; setBasis: (v: ValuationBasis) => void;
  futureDilutions: string[]; setFutureDilutions: (v: string[]) => void;
  onSwitchToSimulator: () => void;
}) {
  const [exitMode, setExitMode] = useState<'berkus' | 'manual'>('berkus');
  const [berkusTotal, setBerkusTotal] = useState<number | null>(null);
  const [berkusLoading, setBerkusLoading] = useState(false);
  const [selectedMultiples, setSelectedMultiples] = useState<number[]>([5]);
  const [useCustomMultiple, setUseCustomMultiple] = useState(false);
  const [customMultiple, setCustomMultiple] = useState('7');
  const [manualExitValue, setManualExitValue] = useState('10000000');

  const selected = cards.find((c) => c.orgId === selectedOrgId) ?? null;

  // Prompt 405 §B.3 — fires whenever the shared selection changes, whether
  // or not this tool is the one currently visible (both tools stay mounted
  // — see EvaluationToolsPanel's own comment on that choice). Cheap: one
  // row per org, same as Berkus's own load.
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

  function toggleMultiple(m: number) {
    setSelectedMultiples((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : prev.length + (useCustomMultiple ? 1 : 0) >= MAX_SCENARIOS ? prev : [...prev, m]));
  }

  const scenarios: ScenarioResult[] = exitMode === 'manual'
    ? [{ label: 'Your exit value', exitValueEur: Number(manualExitValue) || 0 }]
    : berkusTotal == null ? [] : [
        ...selectedMultiples.map((m) => ({ label: `${m}x Berkus`, exitValueEur: berkusTotal * m })),
        ...(useCustomMultiple && customMultiple ? [{ label: `${Number(customMultiple) || 0}x Berkus (custom)`, exitValueEur: berkusTotal * (Number(customMultiple) || 0) }] : []),
      ].slice(0, MAX_SCENARIOS);

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Your own assumptions — private, not investment advice.
      </p>

      {!selected ? (
        <p className="text-sm text-gray-400">Pick a startup from the list on the left to model a return scenario.</p>
      ) : selected.roundValuationEur == null ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>No valuation on file for {selected.name}&apos;s round yet — Return scenario needs real round data to compute your ownership %.</p>
          <button onClick={onSwitchToSimulator} className="mt-2 font-medium text-[#0E7490] hover:underline">
            Switch to the Equity simulator to model your own assumptions →
          </button>
        </div>
      ) : (() => {
        const ticketEur = Number(ticket) || 0;
        const dilution = computeDilution({
          ticketEur, roundValuationEur: selected.roundValuationEur!, roundTargetEur: selected.roundTargetEur ?? 0,
          valuationBasis: basis, futureRoundDilutionsPct: futureDilutions.map((d) => Number(d) || 0),
        });
        const ownershipPct = dilution.ownershipAfterFutureRoundsPct.length > 0
          ? dilution.ownershipAfterFutureRoundsPct[dilution.ownershipAfterFutureRoundsPct.length - 1]
          : dilution.ownershipAfterThisRoundPct;

        return (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5">
                  Your ticket
                  <input type="number" value={ticket} onChange={(e) => setTicket(e.target.value)} className="w-28 rounded border border-gray-300 px-2 py-1" />
                </label>
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
                  <span className="cursor-help text-gray-400"
                    title="Each box is one future round and how much of your stake you expect it to dilute. 10 means you keep 90% of your position after that round.">
                    ⓘ
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {futureDilutions.map((d, i) => (
                    <input key={i} type="number" value={d}
                      onChange={(e) => setFutureDilutions(futureDilutions.map((v, j) => (j === i ? e.target.value : v)))}
                      className="w-16 rounded border border-gray-300 px-1.5 py-1 text-sm" />
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2 border-t border-gray-100 pt-3">
                <span className="text-lg font-semibold text-[#0E7490]">{ownershipPct < 1 ? ownershipPct.toFixed(2) : ownershipPct.toFixed(1)}%</span>
                <span className="text-xs text-gray-500">
                  ownership {futureDilutions.length > 0 ? 'after modeled future rounds' : 'after this round'} — reused from the Ownership calculator&apos;s own math
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="text-xs font-medium text-gray-500">Assumed exit value</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setExitMode('berkus')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${exitMode === 'berkus' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  From my Berkus estimate
                </button>
                <button onClick={() => setExitMode('manual')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${exitMode === 'manual' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  Enter my own exit value
                </button>
              </div>

              {exitMode === 'berkus' ? (
                berkusLoading ? (
                  <p className="mt-3 text-xs text-gray-400">Loading your Berkus estimate…</p>
                ) : berkusTotal == null ? (
                  <p className="mt-3 text-xs text-amber-700">
                    You haven&apos;t estimated Berkus for {selected.name} yet — use the Berkus Method tool first, or enter your own exit value instead.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-500">Your Berkus estimate: <span className="font-medium text-gray-800">{fmtEur(berkusTotal)}</span> — pick one or more growth multiples (up to {MAX_SCENARIOS} scenarios):</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_MULTIPLES.map((m) => (
                        <button key={m} onClick={() => toggleMultiple(m)}
                          disabled={!selectedMultiples.includes(m) && selectedMultiples.length + (useCustomMultiple ? 1 : 0) >= MAX_SCENARIOS}
                          className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40 ${selectedMultiples.includes(m) ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {m}x
                        </button>
                      ))}
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={useCustomMultiple}
                          disabled={!useCustomMultiple && selectedMultiples.length >= MAX_SCENARIOS}
                          onChange={(e) => setUseCustomMultiple(e.target.checked)} />
                        Custom
                        <input type="number" value={customMultiple} disabled={!useCustomMultiple}
                          onChange={(e) => setCustomMultiple(e.target.value)}
                          className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs disabled:bg-gray-50" />
                        x
                      </label>
                    </div>
                  </div>
                )
              ) : (
                <label className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  Exit value (€)
                  <input type="number" value={manualExitValue} onChange={(e) => setManualExitValue(e.target.value)}
                    className="w-40 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
                </label>
              )}
            </div>

            {scenarios.length === 0 ? (
              <p className="text-sm text-gray-400">Pick at least one multiple (or a manual exit value) to see your MOIC.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scenarios.map((s, i) => {
                  const grossExitEur = (ownershipPct / 100) * s.exitValueEur;
                  const moic = ticketEur > 0 ? grossExitEur / ticketEur : 0;
                  return (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                      <div className="text-xs font-semibold text-gray-700">{s.label}</div>
                      <div className="mt-1 text-[11px] text-gray-400">Exit value {fmtEur(s.exitValueEur)}</div>
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <div className="text-2xl font-semibold text-[#0E7490]">{moic.toFixed(1)}x</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {fmtEur(grossExitEur)} on your {fmtEur(ticketEur)} ticket
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
