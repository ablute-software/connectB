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
interface Criterion { id: string; label: string; weight: number; sort_order: number }

function ScorecardCriteriaTool() {
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newWeight, setNewWeight] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch('/api/portal/scorecard/criteria').then((r) => r.json()).then((d) => setCriteria(d.criteria ?? []));
  }
  useEffect(() => { load(); }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/portal/scorecard/criteria', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setError(data.error ?? 'Something went wrong — please try again.'); return; }
      load();
    } finally { setBusy(false); }
  }

  async function addCriterion() {
    if (!newLabel.trim()) return;
    await post({ action: 'create', label: newLabel.trim(), weight: Number(newWeight) || 1 });
    setNewLabel(''); setNewWeight('1');
  }

  function move(index: number, dir: -1 | 1) {
    if (!criteria) return;
    const j = index + dir;
    if (j < 0 || j >= criteria.length) return;
    const order = criteria.map((c) => c.id);
    [order[index], order[j]] = [order[j], order[index]];
    void post({ action: 'reorder', order });
  }

  if (criteria === null) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-gray-500">
        Define the criteria you personally weigh a startup against — score each one from the startup&apos;s own page.
        These are yours alone; a colleague at your firm defines their own set independently.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{error}</p>}

      {criteria.length === 0 ? (
        <p className="text-sm text-gray-400">No criteria yet — add your first one below.</p>
      ) : (
        <ul className="space-y-1.5">
          {criteria.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5 text-sm">
              <div className="flex flex-col">
                <button disabled={i === 0 || busy} onClick={() => move(i, -1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">▲</button>
                <button disabled={i === criteria.length - 1 || busy} onClick={() => move(i, 1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">▼</button>
              </div>
              <span className="flex-1 text-gray-800">{c.label}</span>
              <span className="text-xs text-gray-400">weight {c.weight}</span>
              <button disabled={busy} onClick={() => post({ action: 'delete', id: c.id })}
                className="text-xs text-gray-400 hover:text-[#B00000] disabled:opacity-30">Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-dashed border-gray-200 p-3">
        <label className="flex-1 text-xs text-gray-500">
          New criterion
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Team, Market size, Traction"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-500">
          Weight
          <input type="number" min={0} value={newWeight} onChange={(e) => setNewWeight(e.target.value)}
            className="mt-1 w-16 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <button onClick={addCriterion} disabled={busy || !newLabel.trim()}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
      </div>
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

// Prompt 164 A — the two dilution tools kept being mistaken for duplicates
// (they share computeDilution, so the results LOOK alike); a one-line
// subtitle on each selector button and a header line on each tool spells
// out the real difference: real Pipeline round data vs. your own
// hypothetical numbers.
const TOOLS: { key: 'calculator' | 'simulator' | 'scorecard' | 'berkus'; label: string; subtitle: string }[] = [
  { key: 'calculator', label: 'Ownership calculator', subtitle: 'Real round data from your Pipeline' },
  { key: 'simulator', label: 'Equity simulator', subtitle: 'Your own hypothetical numbers' },
  { key: 'scorecard', label: 'Scorecard criteria', subtitle: 'Your private scoring criteria' },
  { key: 'berkus', label: 'Berkus Method', subtitle: 'Pre-revenue valuation estimate' },
];

export function EvaluationToolsPanel({ initialOrgId }: { initialOrgId?: string | null }) {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [tool, setTool] = useState<'calculator' | 'simulator' | 'scorecard' | 'berkus'>('calculator');
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
      ) : (
        <BerkusMethodTool cards={cards} />
      )}
    </div>
  );
}
