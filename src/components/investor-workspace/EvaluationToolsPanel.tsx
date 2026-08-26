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
import { ReturnScenarioTool } from './ReturnScenarioTool';
import { ComparisonView } from './ComparisonView';
import { ScorecardWeightsEditor } from './ScorecardWeightsEditor';

// Prompt 345 Block E — oneLiner/sectors/stage/matchScore/matchReasons added
// so this same fetch can also feed the comparator moved here from the
// Pipeline (ComparisonView's own Card shape) — never a second /api/portal/
// pipeline call just for that.
interface PipelineCard {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: ValuationBasis | null; matchScore: number; matchReasons: string[];
}
interface Wave { items: PipelineCard[] }
interface PipelineResponse { waves?: Wave[] }
const MAX_COMPARE = 3;

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
              {/* Item 9 — the formula itself, with the investor's own
                  numbers, right where the result is — no tooltip needed to
                  understand what "0.64%" came from. */}
              {result.ownershipAfterFutureRoundsPct.map((pct, i) => (
                <div key={i} className="mt-1 text-xs text-gray-600">
                  After round +{i + 1} (−{futureDilutions[i] || 0}%): <span className="font-medium">{fmtPct(pct)}</span>
                </div>
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

// Prompt 142 Bloco 1 — criteria are managed here (define once); scoring a
// specific startup against them lives on that startup's own dossier page
// (portal/startup/[orgId]) instead, so this stays the CRUD half only —
// keeps the two concerns apart rather than duplicating a scorer here too.
// Prompt 390 §1 — the editor itself (WeightBar + create/reorder/remove/drag
// logic) moved to ScorecardWeightsEditor.tsx: 388 §C.3 was explicit that
// the weight table lives at the TOP of "Your scorecard" (ScorecardPanel.tsx,
// the dossier page's own left column), not here. This tab is left mounting
// the SAME shared component (not a second copy) — Nuno hasn't decided yet
// whether he wants criteria editable from outside a specific startup's
// context too; if he says no, dropping this call site is a one-line follow-up.
function ScorecardCriteriaTool() {
  return (
    <div className="max-w-lg space-y-2">
      <p className="text-sm text-gray-500">
        Define the criteria you personally weigh a startup against — rate each one from the startup&apos;s own dossier, tab by
        tab. These are yours alone; a colleague at your firm defines their own set independently.
      </p>
      <ScorecardWeightsEditor />
    </div>
  );
}

// Prompt 164 C — Berkus Method, the first real valuation method tool: five
// classic risk factors, each manually scored 0–€500,000 (European ceiling
// per the reference doc, not the classic US $500k). Always presented as a
// decomposed per-factor sum, never a single "official" number — and always
// under the permanent private-judgment disclaimer that keeps this on the
// safe side of the open legal question (valuation-as-regulated-service):
// the platform never produces or endorses the number, the investor does,
// from inputs they typed themselves. No auto-inference from the company
// canon at this stage — the canon is too thin to ground it (3 confirmed
// facts platform-wide at time of writing).
const BERKUS_FACTOR_MAX_EUR = 500000;
const BERKUS_FACTORS = [
  { key: 'sound_idea_eur', label: 'Sound idea', hint: 'Basic value of the idea itself — product risk' },
  { key: 'prototype_eur', label: 'Prototype', hint: 'Working prototype — technology risk' },
  { key: 'team_eur', label: 'Quality of the team', hint: 'Execution risk' },
  { key: 'relationships_eur', label: 'Strategic relationships', hint: 'Market/competitive risk' },
  { key: 'sales_eur', label: 'Early sales / rollout', hint: 'Production and financial risk' },
] as const;
type BerkusFactorKey = typeof BERKUS_FACTORS[number]['key'];
type BerkusEstimate = Record<BerkusFactorKey, number>;
const EMPTY_BERKUS: BerkusEstimate = { sound_idea_eur: 0, prototype_eur: 0, team_eur: 0, relationships_eur: 0, sales_eur: 0 };

function BerkusMethodTool({ cards }: { cards: PipelineCard[] }) {
  const [orgId, setOrgId] = useState('');
  const [estimate, setEstimate] = useState<BerkusEstimate>(EMPTY_BERKUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setEstimate(EMPTY_BERKUS); return; }
    setLoading(true); setError(null);
    fetch(`/api/portal/berkus?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json())
      .then((d) => {
        const e = d.estimate as (BerkusEstimate & { updated_at: string }) | null;
        setEstimate(e ? {
          sound_idea_eur: e.sound_idea_eur, prototype_eur: e.prototype_eur, team_eur: e.team_eur,
          relationships_eur: e.relationships_eur, sales_eur: e.sales_eur,
        } : EMPTY_BERKUS);
      })
      .catch(() => setError('Could not load your estimate — try again.'))
      .finally(() => setLoading(false));
  }, [orgId]);

  async function save() {
    if (!orgId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/portal/berkus', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, ...estimate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error ?? 'Could not save — try again.'); return; }
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  const total = BERKUS_FACTORS.reduce((s, f) => s + estimate[f.key], 0);

  return (
    <div className="max-w-lg space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Your own estimate — private, not shown to the startup, not investment advice.
      </p>
      <p className="text-xs text-gray-500">
        The Berkus Method values a <b>pre-revenue</b> startup by pricing five risk areas separately — up to
        €500,000 each, your judgment on every one. The result is the sum of your five estimates, not a
        precise valuation.
      </p>

      <select value={orgId} onChange={(e) => setOrgId(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Select a startup from your Pipeline…</option>
        {cards.map((c) => <option key={c.orgId} value={c.orgId}>{c.name}</option>)}
      </select>

      {!orgId ? (
        <p className="text-sm text-gray-400">Pick a startup above to start estimating.</p>
      ) : loading ? (
        <p className="text-sm text-gray-400">Loading your estimate…</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {error && <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-[#B00000]">{error}</p>}
          <div className="space-y-3">
            {BERKUS_FACTORS.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-800">{f.label} <span className="cursor-help text-gray-400" title={f.hint}>ⓘ</span></span>
                  <span className="font-medium text-[#0E7490]">{fmtEur(estimate[f.key])}</span>
                </div>
                <input type="range" min={0} max={BERKUS_FACTOR_MAX_EUR} step={10000} value={estimate[f.key]}
                  onChange={(e) => setEstimate((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  className="mt-1 w-full accent-[#0E7490]" aria-label={`${f.label} (0 to €500,000)`} />
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-gray-100 pt-3">
            <div className="text-xs text-gray-500">Sum of your five factor estimates</div>
            <div className="text-xl font-semibold text-[#0E7490]">{fmtEur(total)}</div>
            <div className="mt-1 text-[11px] text-gray-400">
              {BERKUS_FACTORS.map((f) => `${f.label} ${fmtEur(estimate[f.key])}`).join(' + ')}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void save()} disabled={saving}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : 'Save estimate'}
            </button>
            <span className="text-[11px] text-gray-400">Saved privately to your seat only.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Prompt 345 Block E — moved here from the Pipeline (checkbox-per-row +
// top banner removed there): the picker + ComparisonView, self-contained.
// compareIds/showComparison used to be lifted all the way up to
// InvestorWorkspaceShell (P169 §B) purely so a selection survived the trip
// from Pipeline to this tab and back — now that the picker lives on this
// tab permanently, that round-trip is gone and the state can just live
// here. `cards` is the exact same fetch this panel's other tools already
// share, enriched (Block E's own reason for widening PipelineCard above).
function CompareStartupsTool({ cards }: { cards: PipelineCard[] }) {
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [scorecardAvgs, setScorecardAvgs] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/portal/scorecard/summary').then((r) => r.json())
      .then((d) => setScorecardAvgs(d.averages ?? {})).catch(() => setScorecardAvgs({}));
  }, []);

  // Prompt 169 §A — lazy, only for the up-to-3 orgIds actually being
  // compared, same reasoning as the Pipeline's own former implementation:
  // Berkus has no batch endpoint, so firing it for every Pipeline card
  // would be real, unnecessary load for a tool almost nobody opens.
  const [compareEnrichment, setCompareEnrichment] = useState<Record<string, { berkusTotal: number | null }>>({});
  useEffect(() => {
    if (!showComparison || compareIds.length === 0) return;
    const missing = compareIds.filter((id) => !(id in compareEnrichment));
    if (missing.length === 0) return;
    Promise.all(missing.map(async (orgId) => {
      const berkusRes = await fetch(`/api/portal/berkus?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).catch(() => ({ estimate: null }));
      const estimate = berkusRes.estimate as { sound_idea_eur: number; prototype_eur: number; team_eur: number; relationships_eur: number; sales_eur: number } | null;
      const berkusTotal = estimate
        ? estimate.sound_idea_eur + estimate.prototype_eur + estimate.team_eur + estimate.relationships_eur + estimate.sales_eur
        : null;
      return [orgId, { berkusTotal }] as const;
    })).then((entries) => {
      setCompareEnrichment((prev) => {
        const next = { ...prev };
        for (const [orgId, enrichment] of entries) next[orgId] = enrichment;
        return next;
      });
    });
  }, [showComparison, compareIds, compareEnrichment]);

  function toggleCompare(orgId: string) {
    setCompareIds((ids) => (ids.includes(orgId) ? ids.filter((id) => id !== orgId) : ids.length < MAX_COMPARE ? [...ids, orgId] : ids));
  }

  const compareCards = compareIds.map((id) => cards.find((c) => c.orgId === id)).filter((c): c is PipelineCard => !!c)
    .map((c) => ({ ...c, scorecardAvg: scorecardAvgs[c.orgId] ?? null, berkusTotal: compareEnrichment[c.orgId]?.berkusTotal ?? null }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Pick up to {MAX_COMPARE} startups from your Pipeline to compare side by side.</p>
      {cards.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing in your Pipeline yet.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          {cards.map((c) => (
            <li key={c.orgId}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={compareIds.includes(c.orgId)} onChange={() => toggleCompare(c.orgId)}
                  disabled={!compareIds.includes(c.orgId) && compareIds.length >= MAX_COMPARE} />
                <span className="text-gray-800">{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => setCompareIds([])} disabled={compareIds.length === 0} className="text-xs text-gray-500 hover:underline disabled:opacity-40">Clear</button>
        <button onClick={() => setShowComparison(true)} disabled={compareIds.length < 2}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          Compare ({compareIds.length})
        </button>
      </div>
      {showComparison && compareCards.length >= 2 && (
        <ComparisonView cards={compareCards} onClose={() => setShowComparison(false)} />
      )}
    </div>
  );
}

// Prompt 164 A — the two dilution tools kept being mistaken for duplicates
// (they share computeDilution, so the results LOOK alike); a one-line
// subtitle on each selector button and a header line on each tool spells
// out the real difference: real Pipeline round data vs. your own
// hypothetical numbers.
const TOOLS: { key: 'calculator' | 'simulator' | 'scorecard' | 'berkus' | 'return' | 'compare'; label: string; subtitle: string }[] = [
  { key: 'calculator', label: 'Ownership calculator', subtitle: 'Real round data from your Pipeline' },
  { key: 'simulator', label: 'Equity simulator', subtitle: 'Your own hypothetical numbers' },
  { key: 'scorecard', label: 'Scorecard criteria', subtitle: 'Your private scoring criteria' },
  { key: 'berkus', label: 'Berkus Method', subtitle: 'Pre-revenue valuation estimate' },
  // Prompt 169 §C — MOIC over the same real ownership math as the
  // calculator above, against an assumed exit value (from Berkus × a
  // growth multiple, or typed directly).
  { key: 'return', label: 'Return scenario', subtitle: 'Model MOIC against an exit value' },
  // Prompt 345 Block E — moved here from the Pipeline (checkbox-per-row +
  // banner removed there); this tool IS the comparator now, not a shortcut
  // back to another tab.
  { key: 'compare', label: 'Compare startups', subtitle: 'Side-by-side, up to 3 from your Pipeline' },
];

export function EvaluationToolsPanel({ initialOrgId }: {
  initialOrgId?: string | null;
}) {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [tool, setTool] = useState<'calculator' | 'simulator' | 'scorecard' | 'berkus' | 'return' | 'compare'>('calculator');
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId ?? '');

  useEffect(() => {
    fetch('/api/portal/pipeline').then((r) => r.json()).then((d: PipelineResponse) => {
      setCards((d.waves ?? []).flatMap((w) => w.items));
    }).catch(() => {});
  }, []);

  // A shortcut from a Pipeline card (item 4 of P131-B) opens straight into
  // the calculator with that startup already selected.
  //
  // Prompt 354 §C — the dossier's own "Equity calculator" deep link used to
  // land here with NOTHING selected whenever the target startup's Pipeline
  // WAVE wasn't unlocked yet: /api/portal/pipeline zeroes out a locked
  // wave's `items` entirely (route.ts's own wave-dosage gate), so `cards`
  // never contained that org even though the investor was legitimately
  // looking at its full dossier a moment earlier. Fetching that one org
  // directly (the same route the dossier page itself already used to get
  // there) and merging it in sidesteps the wave gate for exactly the
  // startup the investor already has real access to — never a bypass for
  // any OTHER org, since selectedOrgId only ever comes from initialOrgId
  // here, not from user input.
  useEffect(() => {
    if (!initialOrgId) return;
    setSelectedOrgId(initialOrgId); setTool('calculator');
    fetch(`/api/portal/startup/${initialOrgId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.card) return;
      const c = d.card as { orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null; roundTargetEur: number | null; roundValuationEur: number | null; roundValuationBasis?: ValuationBasis | null; matchScore: number; matchReasons: string[] };
      setCards((prev) => (prev.some((p) => p.orgId === c.orgId) ? prev : [...prev, c]));
    }).catch(() => {});
  }, [initialOrgId]);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-gray-900">Evaluation tools</h1>
        {/* Prompt 345 Block E — "the shortcut that already exists becomes
            THE path": same entry point, now opens the comparator right
            here instead of jumping back to the Pipeline tab. */}
        <button onClick={() => setTool('compare')} className="text-xs font-medium text-[#0E7490] hover:underline">
          Compare startups from your Pipeline →
        </button>
      </div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {TOOLS.map((t) => (
          <button key={t.key} onClick={() => setTool(t.key)}
            className={`rounded-xl px-3 py-1.5 text-left ${tool === t.key ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <span className="block text-xs font-medium">{t.label}</span>
            <span className={`block text-[10px] ${tool === t.key ? 'text-white/70' : 'text-gray-400'}`}>{t.subtitle}</span>
          </button>
        ))}
      </div>

      {tool === 'calculator' ? (
        <>
          <p className="text-xs text-gray-500">
            How much of a <b>real startup from your Pipeline</b> your ticket buys, using the round data that startup actually registered — for the &quot;what do I get in this specific deal&quot; question.
          </p>
          <OwnershipCalculatorTool cards={cards} selectedOrgId={selectedOrgId} onSelectOrg={setSelectedOrgId} onSwitchToSimulator={() => setTool('simulator')} />
        </>
      ) : tool === 'simulator' ? (
        <>
          <p className="text-xs text-gray-500">
            The same math over <b>your own hypothetical numbers</b> — up to 3 what-if scenarios side by side, independent of any startup&apos;s registered data (you can prefill one from a real startup, then edit freely).
          </p>
          <EquitySimulatorTool cards={cards} />
        </>
      ) : tool === 'scorecard' ? (
        <ScorecardCriteriaTool />
      ) : tool === 'berkus' ? (
        <BerkusMethodTool cards={cards} />
      ) : tool === 'compare' ? (
        <CompareStartupsTool cards={cards} />
      ) : (
        <ReturnScenarioTool cards={cards} onSwitchToSimulator={() => setTool('simulator')} />
      )}
    </div>
  );
}
