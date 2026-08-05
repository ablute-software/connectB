'use client';
// P131-B — "Evaluation tools" tab (mini_prompt_itens_2_3_4, item 3). Two
// tools, one shared math engine (computeDilution, unchanged):
// - Ownership calculator: pick a startup from the Pipeline, read its real
//   round data. Dead-ends honestly ("No valuation on file") for a startup
//   that hasn't registered one — the mock/Sherlock Deal_ test case that
//   prompted this — pointing at the simulator instead of just failing.
// - Equity simulator: the investor's own hypothetical numbers, independent
//   of any startup's data, pre/post-money toggle explicit, up to 3
//   scenarios side by side.
import { useEffect, useState } from 'react';
import { computeDilution, type ValuationBasis } from '@/lib/dilution';

interface PipelineCard {
  orgId: string; name: string; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: ValuationBasis | null;
}
interface Wave { items: PipelineCard[] }
interface PipelineResponse { waves?: Wave[] }

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

function OwnershipCalculatorTool({ cards, selectedOrgId, onSelectOrg, onSwitchToSimulator }: {
  cards: PipelineCard[]; selectedOrgId: string; onSelectOrg: (orgId: string) => void; onSwitchToSimulator: () => void;
}) {
  const selected = cards.find((c) => c.orgId === selectedOrgId) ?? null;
  const [ticket, setTicket] = useState('50000');
  const [basis, setBasis] = useState<ValuationBasis>(selected?.roundValuationBasis ?? 'pre_money');
  const [futureDilutions, setFutureDilutions] = useState(['20', '15']);

  // Re-seed the basis when the selected startup changes, same as the old
  // per-card calculator did on mount — never overrides a basis the investor
  // already picked by hand for the CURRENT startup.
  useEffect(() => {
    setBasis(selected?.roundValuationBasis ?? 'pre_money');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId]);

  return (
    <div className="space-y-4">
      <select value={selectedOrgId} onChange={(e) => onSelectOrg(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Select a startup from your Pipeline…</option>
        {cards.map((c) => <option key={c.orgId} value={c.orgId}>{c.name}</option>)}
      </select>

      {!selected ? (
        <p className="text-sm text-gray-400">Pick a startup above to see its ownership math.</p>
      ) : selected.roundValuationEur == null ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>No valuation on file for {selected.name}&apos;s round yet — the calculator needs one.</p>
          <button onClick={onSwitchToSimulator} className="mt-2 font-medium text-[#0E7490] hover:underline">
            Switch to the Equity simulator to model your own assumptions →
          </button>
        </div>
      ) : (() => {
        const ticketEur = Number(ticket) || 0;
        const result = computeDilution({
          ticketEur, roundValuationEur: selected.roundValuationEur, roundTargetEur: selected.roundTargetEur ?? 0,
          valuationBasis: basis, futureRoundDilutionsPct: futureDilutions.map((d) => Number(d) || 0),
        });
        return (
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

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[#0E7490]">{fmtPct(result.ownershipAfterThisRoundPct)}</span>
              <span className="text-gray-500">ownership after this round · post-money {fmtEur(result.postMoneyEur)}</span>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs text-gray-500">Hypothetical future rounds (dilution %):</div>
              <div className="flex flex-wrap items-center gap-2">
                {futureDilutions.map((d, i) => (
                  <input key={i} type="number" value={d}
                    onChange={(e) => setFutureDilutions(futureDilutions.map((v, j) => (j === i ? e.target.value : v)))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-sm" />
                ))}
              </div>
              {result.ownershipAfterFutureRoundsPct.map((pct, i) => (
                <div key={i} className="mt-1 text-xs text-gray-600">After round +{i + 1}: <span className="font-medium">{fmtPct(pct)}</span></div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

let scenarioSeq = 0;
interface Scenario { id: number; label: string; ticket: string; valuation: string; basis: ValuationBasis; roundTarget: string }
function newScenario(seed?: Partial<Scenario>): Scenario {
  scenarioSeq += 1;
  return {
    id: scenarioSeq, label: `Scenario ${scenarioSeq}`, ticket: '50000', valuation: '5000000',
    basis: 'pre_money', roundTarget: '1000000', ...seed,
  };
}
const MAX_SCENARIOS = 3;

function EquitySimulatorTool({ cards }: { cards: PipelineCard[] }) {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [newScenario()]);
  const [prefillOrgId, setPrefillOrgId] = useState('');

  function updateScenario(id: number, patch: Partial<Scenario>) {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addScenario() {
    setScenarios((prev) => (prev.length >= MAX_SCENARIOS ? prev : [...prev, newScenario()]));
  }
  function removeScenario(id: number) {
    setScenarios((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }
  function prefillFrom(orgId: string) {
    setPrefillOrgId(orgId);
    const card = cards.find((c) => c.orgId === orgId);
    if (!card || !scenarios[0]) return;
    updateScenario(scenarios[0].id, {
      label: card.name,
      valuation: card.roundValuationEur != null ? String(card.roundValuationEur) : scenarios[0].valuation,
      roundTarget: card.roundTargetEur != null ? String(card.roundTargetEur) : scenarios[0].roundTarget,
      basis: card.roundValuationBasis ?? scenarios[0].basis,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          Prefill scenario 1 from a real startup (optional)
          <select value={prefillOrgId} onChange={(e) => prefillFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">None</option>
            {cards.map((c) => <option key={c.orgId} value={c.orgId}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((s) => {
          const ticketEur = Number(s.ticket) || 0;
          const valuationEur = Number(s.valuation) || 0;
          const roundTargetEur = Number(s.roundTarget) || 0;
          const result = computeDilution({
            ticketEur, roundValuationEur: valuationEur, roundTargetEur, valuationBasis: s.basis,
            futureRoundDilutionsPct: [],
          });
          return (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <input value={s.label} onChange={(e) => updateScenario(s.id, { label: e.target.value })}
                  className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700" />
                {scenarios.length > 1 && (
                  <button onClick={() => removeScenario(s.id)} className="shrink-0 text-xs text-gray-400 hover:text-[#B00000]">✕</button>
                )}
              </div>
              <label className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                Ticket
                <input type="number" value={s.ticket} onChange={(e) => updateScenario(s.id, { ticket: e.target.value })}
                  className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
              </label>
              <label className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                Valuation
                <input type="number" value={s.valuation} onChange={(e) => updateScenario(s.id, { valuation: e.target.value })}
                  className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
              </label>
              <label className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                Basis
                <select value={s.basis} onChange={(e) => updateScenario(s.id, { basis: e.target.value as ValuationBasis })}
                  className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900">
                  <option value="pre_money">Pre-money</option>
                  <option value="post_money">Post-money</option>
                </select>
              </label>
              {s.basis === 'pre_money' && (
                <label className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                  Round size
                  <input type="number" value={s.roundTarget} onChange={(e) => updateScenario(s.id, { roundTarget: e.target.value })}
                    className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
                </label>
              )}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="text-xl font-semibold text-[#0E7490]">{fmtPct(result.ownershipAfterThisRoundPct)}</div>
                <div className="text-xs text-gray-500">
                  {s.basis === 'pre_money'
                    ? <>ticket / (valuation + round) · post-money {fmtEur(result.postMoneyEur)}</>
                    : <>ticket / valuation · post-money {fmtEur(result.postMoneyEur)}</>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {scenarios.length < MAX_SCENARIOS && (
        <button onClick={addScenario} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          + Add scenario
        </button>
      )}
    </div>
  );
}

export function EvaluationToolsPanel({ initialOrgId }: { initialOrgId?: string | null }) {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [tool, setTool] = useState<'calculator' | 'simulator'>('calculator');
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId ?? '');

  useEffect(() => {
    fetch('/api/portal/pipeline').then((r) => r.json()).then((d: PipelineResponse) => {
      setCards((d.waves ?? []).flatMap((w) => w.items));
    }).catch(() => {});
  }, []);

  // A shortcut from a Pipeline card (item 4 of P131-B) opens straight into
  // the calculator with that startup already selected.
  useEffect(() => {
    if (initialOrgId) { setSelectedOrgId(initialOrgId); setTool('calculator'); }
  }, [initialOrgId]);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Evaluation tools</h1>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setTool('calculator')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${tool === 'calculator' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          Ownership calculator
        </button>
        <button onClick={() => setTool('simulator')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${tool === 'simulator' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          Equity simulator
        </button>
      </div>

      {tool === 'calculator' ? (
        <OwnershipCalculatorTool cards={cards} selectedOrgId={selectedOrgId} onSelectOrg={setSelectedOrgId} onSwitchToSimulator={() => setTool('simulator')} />
      ) : (
        <EquitySimulatorTool cards={cards} />
      )}
    </div>
  );
}
