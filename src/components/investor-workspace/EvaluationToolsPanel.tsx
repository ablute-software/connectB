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
//
// Prompt 405 — two changes on top of the above:
// §A: the startup picker used to be repeated inside every tool, and the
// whole panel sat in a max-w-3xl column with a large empty gap on wide
// screens. It's now a single picker in a sticky left column (405 §A.2),
// with the tool strip + active tool in a right column that gets the same
// max-w-6xl width other wide tabs already use (InvestorWorkspaceShell.tsx).
// §B: selection and trial values (ticket/basis/futureDilutions) are lifted
// here and shared by the calculator and Return scenario — typing a ticket
// once, switching tools, no longer re-typing it. All six tools stay
// mounted simultaneously (hidden via CSS rather than conditionally
// rendered) so nothing a tool doesn't own itself (simulator scenarios,
// compare selection, Return scenario's exit assumptions) is lost when
// switching tabs — the alternative (lifting every one of those up here
// too) is substantially more code for the same behavioral guarantee. The
// cost: Berkus's and Return scenario's own per-org fetches now fire
// whenever the shared selection changes, not only while that tool happens
// to be open — cheap (one row per org), documented at each fetch site.
import { useEffect, useState } from 'react';
import { computeDilution, type ValuationBasis } from '@/lib/dilution';
import { ScenariosReturnsTool } from './ScenariosReturnsTool';
import { ComparisonView } from './ComparisonView';
import { ScorecardWeightsEditor } from './ScorecardWeightsEditor';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import {
  filterCardsByName, highestFitCandidate, uncontactedCandidates,
  type EvaluationPipelineCard as PipelineCard,
} from '@/lib/evaluation-startup-discovery';
import { EVALUATION_TOOLS_INTRO_CONTENT, shouldShowEvaluationToolsIntro } from '@/lib/evaluation-tools-intro';

interface Wave { items: PipelineCard[] }
interface PipelineResponse { waves?: Wave[] }
const MAX_COMPARE = 3;

// Prompt 420 §B.1 — "first open per login (fresh session)", not per mount:
// InvestorWorkspaceShell conditionally renders every tab (`{tab ===
// 'evaluation' && <EvaluationToolsPanel />}`), so this component fully
// unmounts on every tab switch and remounts fresh on return — plain
// component state would reset right along with it. A module-level flag
// survives across those remounts (reset only by an actual page load/new
// login, which is exactly the granularity this prompt asks for) without
// needing any persistence for this part, per §B.1's own instruction.
let hasShownEvaluationToolsIntroThisSession = false;

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

// Prompt 405 §A.2 — the one and only startup selector left in this panel.
// A scrollable clickable list rather than a <select>: with up to a few
// dozen Pipeline cards, it makes the current selection visibly obvious
// (the prompt's own reasoning) in a way a native dropdown's closed state
// can't. Sticky so it stays in view while the right column scrolls.
//
// Prompt 419 — three additions, all scoped to this component: §A a
// client-side name search (cards are already loaded, no new request);
// §B a "grow this list" CTA into a discovery MODE (not a new page) that
// swaps this same list for the eligible-but-uncontacted set — reusing
// `cards` (already wave-gating-respected, see /api/portal/pipeline's own
// locked-wave stripping) rather than widening what's eligible; §C a
// once-ever sweep on that mode's highest-fit card.
function EvaluationStartupPicker({ cards, selectedOrgId, onSelectOrg, showsUnusedNote }: {
  cards: PipelineCard[]; selectedOrgId: string; onSelectOrg: (orgId: string) => void; showsUnusedNote: boolean;
}) {
  const selected = cards.find((c) => c.orgId === selectedOrgId) ?? null;
  const [search, setSearch] = useState('');
  const [discoveryMode, setDiscoveryMode] = useState(false);
  const { seen, markSeen } = useOnboarding();

  const filteredCards = filterCardsByName(cards, search);
  const uncontacted = uncontactedCandidates(cards);

  // Prompt 419 §C.3 — "once in the investor's lifetime", not per session/
  // mount: captured into state the moment discovery mode opens (rather
  // than recomputed every render from `seen`) so the sweep keeps playing
  // for its full duration even after markSeen flips seen.pipeline_fit_sweep
  // to true a moment later — recomputing live would yank the class off
  // before the animation finishes. Deliberately depends only on
  // discoveryMode (not seen/cards/markSeen) — this is meant to fire once
  // per "open", not react to its own markSeen call re-running it.
  const [sweepTargetOrgId, setSweepTargetOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!discoveryMode || seen.pipeline_fit_sweep) return;
    const top = highestFitCandidate(uncontactedCandidates(cards));
    if (!top) return;
    setSweepTargetOrgId(top.orgId);
    markSeen('pipeline_fit_sweep');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryMode]);

  return (
    <div className="space-y-3 md:sticky md:top-4 md:self-start">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Startup</div>

      {discoveryMode ? (
        <>
          <button onClick={() => setDiscoveryMode(false)} className="text-xs font-medium text-[#0E7490] hover:underline">
            ← Back to your list
          </button>
          <p className="text-[11px] text-gray-500">Already eligible, not yet contacted — highest fit first.</p>
          {uncontacted.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing uncontacted left — you&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-[420px] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1.5">
              {uncontacted.map((c) => (
                <li key={c.orgId} className={c.orgId === sweepTargetOrgId ? 'pipeline-fit-sweep-card rounded-lg' : undefined}>
                  <button onClick={() => onSelectOrg(c.orgId)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      selectedOrgId === c.orgId ? 'bg-[#0E7490] text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {cards.length > 0 && (
            <div className="relative">
              <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400">
                <circle cx="8.3" cy="8.3" r="5.3" />
                <path d="m16.3 16.3-3.4-3.4" strokeLinecap="round" />
              </svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…"
                className="w-full rounded-lg border border-gray-300 py-1.5 pl-7 pr-2 text-sm" />
            </div>
          )}
          {cards.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing in your Pipeline yet.</p>
          ) : filteredCards.length === 0 ? (
            <p className="text-sm text-gray-400">No startups match &quot;{search}&quot;.</p>
          ) : (
            <ul className="max-h-[420px] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1.5">
              {filteredCards.map((c) => (
                <li key={c.orgId}>
                  <button onClick={() => onSelectOrg(c.orgId)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      selectedOrgId === c.orgId ? 'bg-[#0E7490] text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {uncontacted.length > 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
              <p>Want more startups here? Express first interest, or request access to a first document — that&apos;s what adds them to your active list.</p>
              <button onClick={() => setDiscoveryMode(true)} className="mt-2 font-medium text-[#0E7490] hover:underline">
                See uncontacted pipeline →
              </button>
            </div>
          )}
        </>
      )}

      {selected && !discoveryMode && (
        <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
          <div className="text-sm font-semibold text-gray-900">{selected.name}</div>
          {selected.stage && <div>{selected.stage}</div>}
          {selected.sectors.length > 0 && <div className="text-gray-500">{selected.sectors.join(', ')}</div>}
          {selected.roundTargetEur != null && <div>Round target: <span className="font-medium text-gray-800">{fmtEur(selected.roundTargetEur)}</span></div>}
          {selected.roundValuationEur != null && <div>Valuation: <span className="font-medium text-gray-800">{fmtEur(selected.roundValuationEur)}</span></div>}
        </div>
      )}
      {showsUnusedNote && (
        <p className="text-[11px] text-gray-400">Criteria apply to every startup — pick one from any other tool.</p>
      )}
    </div>
  );
}

function OwnershipCalculatorTool({ cards, selectedOrgId, ticket, setTicket, basis, setBasis, futureDilutions, setFutureDilutions, onSwitchToSimulator }: {
  cards: PipelineCard[]; selectedOrgId: string;
  ticket: string; setTicket: (v: string) => void;
  basis: ValuationBasis; setBasis: (v: ValuationBasis) => void;
  futureDilutions: string[]; setFutureDilutions: (v: string[]) => void;
  onSwitchToSimulator: () => void;
}) {
  const selected = cards.find((c) => c.orgId === selectedOrgId) ?? null;

  return (
    <div className="space-y-4">
      {!selected ? (
        <p className="text-sm text-gray-400">Pick a startup from the list on the left to see its ownership math.</p>
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

function EquitySimulatorTool({ cards, selectedOrgId }: { cards: PipelineCard[]; selectedOrgId: string }) {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [newScenario()]);
  const selectedCard = cards.find((c) => c.orgId === selectedOrgId) ?? null;

  function updateScenario(id: number, patch: Partial<Scenario>) {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addScenario() {
    setScenarios((prev) => (prev.length >= MAX_SCENARIOS ? prev : [...prev, newScenario()]));
  }
  function removeScenario(id: number) {
    setScenarios((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }
  // Prompt 405 §B.1 — replaces the old "prefill scenario 1" dropdown: the
  // startup is already chosen in the left column, so this is a one-click
  // convenience against that same selection rather than a second picker.
  function prefillFromSelected() {
    if (!selectedCard || !scenarios[0]) return;
    updateScenario(scenarios[0].id, {
      label: selectedCard.name,
      valuation: selectedCard.roundValuationEur != null ? String(selectedCard.roundValuationEur) : scenarios[0].valuation,
      roundTarget: selectedCard.roundTargetEur != null ? String(selectedCard.roundTargetEur) : scenarios[0].roundTarget,
      basis: selectedCard.roundValuationBasis ?? scenarios[0].basis,
    });
  }

  return (
    <div className="space-y-4">
      {selectedCard && (
        <button onClick={prefillFromSelected}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          Prefill from {selectedCard.name}
        </button>
      )}

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

// Prompt 408 §B — one snapshot history entry, shape shared by every tool
// that saves them (evaluation_snapshots.kind); Berkus only ever reads
// its own inputs/outputs shape back.
interface EvaluationSnapshot { id: string; inputs: Record<string, unknown>; outputs: Record<string, unknown>; created_at: string }

function BerkusMethodTool({ cards, selectedOrgId }: { cards: PipelineCard[]; selectedOrgId: string }) {
  const [estimate, setEstimate] = useState<BerkusEstimate>(EMPTY_BERKUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<EvaluationSnapshot[]>([]);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const selectedName = cards.find((c) => c.orgId === selectedOrgId)?.name;

  function loadSnapshots(orgId: string) {
    fetch(`/api/portal/evaluation-snapshots?orgId=${encodeURIComponent(orgId)}&kind=berkus`).then((r) => r.json())
      .then((d) => setSnapshots(d.snapshots ?? [])).catch(() => setSnapshots([]));
  }

  // Prompt 405 §B.3 — fires whenever the shared selection changes, whether
  // or not this tool is the one currently visible (all six tools stay
  // mounted). Documented choice: accepting the earlier fetch instead of
  // gating it on this tool being open — it's one row per org, and gating
  // it would mean re-fetching every time the investor switches back in.
  useEffect(() => {
    if (!selectedOrgId) { setEstimate(EMPTY_BERKUS); setSnapshots([]); return; }
    setLoading(true); setError(null);
    fetch(`/api/portal/berkus?orgId=${encodeURIComponent(selectedOrgId)}`).then((r) => r.json())
      .then((d) => {
        const e = d.estimate as (BerkusEstimate & { updated_at: string }) | null;
        setEstimate(e ? {
          sound_idea_eur: e.sound_idea_eur, prototype_eur: e.prototype_eur, team_eur: e.team_eur,
          relationships_eur: e.relationships_eur, sales_eur: e.sales_eur,
        } : EMPTY_BERKUS);
      })
      .catch(() => setError('Could not load your estimate — try again.'))
      .finally(() => setLoading(false));
    loadSnapshots(selectedOrgId);
  }, [selectedOrgId]);

  async function save() {
    if (!selectedOrgId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/portal/berkus', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: selectedOrgId, ...estimate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error ?? 'Could not save — try again.'); return; }
      setSavedAt(Date.now());
      loadSnapshots(selectedOrgId); // Prompt 408 §B.2 — the save above also appended a snapshot server-side
    } finally { setSaving(false); }
  }

  function restoreSnapshot(s: EvaluationSnapshot) {
    setEstimate({ ...EMPTY_BERKUS, ...(s.inputs as Partial<BerkusEstimate>) });
    setConfirmRestoreId(null);
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

      {!selectedOrgId ? (
        <p className="text-sm text-gray-400">Pick a startup from the list on the left to start estimating.</p>
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
            <span className="text-[11px] text-gray-400">Saved privately to your seat only{selectedName ? ` — ${selectedName}` : ''}.</span>
          </div>

          {/* Prompt 408 §B.3 — History: last N saves, a discrete list (a
              full visual timeline is future-wave scope per the prompt's
              own words). Restoring is two clicks — Restore, then Confirm
              — so a click never silently discards the form's current
              (possibly unsaved) values. */}
          {snapshots.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500">History</div>
              <ul className="mt-1.5 space-y-1">
                {snapshots.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-xs text-gray-600">
                    <span>{new Date(s.created_at).toLocaleDateString()} — {fmtEur((s.outputs as { totalEur: number }).totalEur ?? 0)}</span>
                    {confirmRestoreId === s.id ? (
                      <span className="flex items-center gap-2">
                        <button onClick={() => restoreSnapshot(s)} className="font-medium text-[#0E7490] hover:underline">Confirm restore</button>
                        <button onClick={() => setConfirmRestoreId(null)} className="text-gray-400 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmRestoreId(s.id)} className="text-[#0E7490] hover:underline">Restore</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
function CompareStartupsTool({ cards, selectedOrgId, active }: { cards: PipelineCard[]; selectedOrgId: string; active: boolean }) {
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [scorecardAvgs, setScorecardAvgs] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/portal/scorecard/summary').then((r) => r.json())
      .then((d) => setScorecardAvgs(d.averages ?? {})).catch(() => setScorecardAvgs({}));
  }, []);

  // Prompt 405 §C — this tool keeps its own multi-select (deliberately not
  // the shared single selection), but preloads the shared selection as the
  // first compare item the moment this tool becomes active with nothing
  // picked yet — a convenience, never forced. Keyed on `active` rather than
  // mount, since every tool now stays mounted (405 §B.4) — there's no mount
  // event to key this off of anymore.
  useEffect(() => {
    if (active && compareIds.length === 0 && selectedOrgId) setCompareIds([selectedOrgId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

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
// Prompt 418 §B — reordered to follow the real evaluation funnel (orient →
// crudest estimate → structured qualitative judgment → real-deal math →
// hypotheticals → full probabilistic model), the same funnel the approved
// Investor Decision System study used. Keys/labels/subtitles unchanged —
// only the array order moved.
// Prompt 420 — the intro pamphlet. Never blocking: a plain panel in the
// center column (never a modal/overlay), closable via X/"Got it", with the
// tools reachable below it without closing first (the caller just renders
// this ABOVE the rest of the center column's content, not on top of it).
function EvaluationToolsIntro({ onClose, onMute }: { onClose: () => void; onMute: () => void }) {
  const [muteChecked, setMuteChecked] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">New here? A quick tour of the 6 tools</h2>
          <p className="mt-0.5 text-xs text-gray-500">What each one does, how it works, and what it tells you.</p>
        </div>
        <button onClick={onClose} aria-label="Got it" className="shrink-0 text-gray-400 hover:text-gray-700">✕</button>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <input type="checkbox" checked={muteChecked} onChange={(e) => setMuteChecked(e.target.checked)} className="h-3.5 w-3.5" />
        Tell Watson I don&apos;t want to read this anymore.
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {EVALUATION_TOOLS_INTRO_CONTENT.map((entry) => (
          <div key={entry.key} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-xs">
            <div className="font-semibold text-gray-900">{entry.title}</div>
            <div className="mt-1 text-gray-600"><span className="font-medium text-gray-500">What: </span>{entry.what}</div>
            <div className="mt-0.5 text-gray-600"><span className="font-medium text-gray-500">How: </span>{entry.how}</div>
            <div className="mt-0.5 text-gray-600"><span className="font-medium text-gray-500">Concludes: </span>{entry.concludes}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={() => { if (muteChecked) onMute(); onClose(); }}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c637b]">
          Got it
        </button>
      </div>
    </div>
  );
}

const TOOLS: { key: 'calculator' | 'simulator' | 'scorecard' | 'berkus' | 'return' | 'compare'; label: string; subtitle: string }[] = [
  // Prompt 345 Block E — moved here from the Pipeline (checkbox-per-row +
  // banner removed there); this tool IS the comparator now, not a shortcut
  // back to another tab.
  { key: 'compare', label: 'Compare startups', subtitle: 'Side-by-side, up to 3 from your Pipeline' },
  { key: 'berkus', label: 'Berkus Method', subtitle: 'Pre-revenue valuation estimate' },
  { key: 'scorecard', label: 'Scorecard criteria', subtitle: 'Your private scoring criteria' },
  { key: 'calculator', label: 'Ownership calculator', subtitle: 'Real round data from your Pipeline' },
  { key: 'simulator', label: 'Equity simulator', subtitle: 'Your own hypothetical numbers' },
  // Prompt 169 §C — MOIC over the same real ownership math as the
  // calculator above. Prompt 408 §A.3 — evolved from a single assumed
  // exit into up to 5 weighted scenarios (Failure→Outlier) plus the VC
  // Method's required-exit inversion.
  { key: 'return', label: 'Scenarios & returns', subtitle: 'Failure→outlier scenarios, weighted MOIC & IRR' },
];

export function EvaluationToolsPanel({ initialOrgId }: {
  initialOrgId?: string | null;
}) {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [tool, setTool] = useState<'calculator' | 'simulator' | 'scorecard' | 'berkus' | 'return' | 'compare'>('calculator');
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId ?? '');

  // Prompt 405 §B.2 — trial values shared by the Ownership calculator and
  // Return scenario (one investor typing one ticket, not two). §B.5: only
  // `basis` re-seeds when the startup changes (below); ticket and
  // futureDilutions are the investor's own and survive a startup switch.
  const [ticket, setTicket] = useState('50000');
  const [basis, setBasis] = useState<ValuationBasis>('pre_money');
  const [futureDilutions, setFutureDilutions] = useState(['20', '15']);

  // Prompt 420 §B.1/§B.3 — waits on `loaded` before deciding: evaluating
  // shouldShowEvaluationToolsIntro against the provider's own initial
  // (pre-fetch) default of muted:false would show the pamphlet for a split
  // second even for an investor who already muted it, right before the
  // real value arrives and hides it again.
  const { loaded: onboardingLoaded, evaluationToolsIntroMuted, setEvaluationToolsIntroMuted } = useOnboarding();
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    if (!onboardingLoaded) return;
    if (shouldShowEvaluationToolsIntro({ muted: evaluationToolsIntroMuted, shownThisSession: hasShownEvaluationToolsIntroThisSession })) {
      hasShownEvaluationToolsIntroThisSession = true;
      setShowIntro(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingLoaded]);

  useEffect(() => {
    fetch('/api/portal/pipeline').then((r) => r.json()).then((d: PipelineResponse) => {
      setCards((d.waves ?? []).flatMap((w) => w.items));
    }).catch(() => {});
  }, []);

  // Re-seed the basis when the selected startup changes, same as the old
  // per-card calculator did on mount — never overrides a basis the investor
  // already picked by hand for the CURRENT startup. Deliberately keyed only
  // on selectedOrgId (not on `cards`, which can still be loading when a
  // deep-link sets the selection below) — same tradeoff the original
  // per-tool version made, just now shared by two tools instead of one.
  useEffect(() => {
    const selected = cards.find((c) => c.orgId === selectedOrgId);
    setBasis(selected?.roundValuationBasis ?? 'pre_money');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId]);

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
      // Prompt 419 — widened to the full PipelineCard shape: /api/portal/
      // startup/[orgId] returns the exact same card object getPipelineWaves
      // builds for the main Pipeline fetch (route.ts's own `{ card, ... }`,
      // unreshaped), so status/isArchived/viaGrant/etc. are already on the
      // wire here too — this cast just stopped throwing them away.
      const c = d.card as PipelineCard;
      setCards((prev) => (prev.some((p) => p.orgId === c.orgId) ? prev : [...prev, c]));
    }).catch(() => {});
  }, [initialOrgId]);

  return (
    // Prompt 418 §A — three real columns (picker, active tool, tool list),
    // center clearly widest. On mobile this `grid` has no explicit
    // grid-cols below `md:`, so it just stacks in DOM order — picker →
    // active tool → tool list — matching §A.5's own suggested order with
    // no extra `order-*` classes needed.
    <div className="grid gap-4 md:grid-cols-[260px_1fr_280px] md:items-start">
      <EvaluationStartupPicker cards={cards} selectedOrgId={selectedOrgId} onSelectOrg={setSelectedOrgId} showsUnusedNote={tool === 'scorecard'} />

      <div className="min-w-0 space-y-4">
        {/* Prompt 420 §B.2 — never blocking: a plain panel ABOVE the rest
            of this column, not an overlay on top of it — the header and
            every tool below stay reachable by scrolling past it, no need
            to close first. */}
        {showIntro && (
          <EvaluationToolsIntro
            onClose={() => setShowIntro(false)}
            onMute={() => setEvaluationToolsIntroMuted(true)}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-gray-900">Evaluation tools</h1>
          {/* Prompt 345 Block E — "the shortcut that already exists becomes
              THE path": same entry point, now opens the comparator right
              here instead of jumping back to the Pipeline tab. */}
          <button onClick={() => setTool('compare')} className="text-xs font-medium text-[#0E7490] hover:underline">
            Compare startups from your Pipeline →
          </button>
        </div>

        {/* Prompt 405 §B.4 — all six tools stay mounted; only the active one
            is shown. The alternative (conditional rendering, as this used
            to be) unmounts the inactive tool and loses whatever state it
            doesn't get from props — simulator scenarios, compare's
            selection, Return scenario's exit assumptions. Hiding via CSS
            costs one extra render tree each, paid once, not per switch. */}
        <div className={tool === 'calculator' ? 'space-y-4' : 'hidden'}>
          <p className="text-xs text-gray-500">
            How much of a <b>real startup from your Pipeline</b> your ticket buys, using the round data that startup actually registered — for the &quot;what do I get in this specific deal&quot; question.
          </p>
          <OwnershipCalculatorTool cards={cards} selectedOrgId={selectedOrgId}
            ticket={ticket} setTicket={setTicket} basis={basis} setBasis={setBasis}
            futureDilutions={futureDilutions} setFutureDilutions={setFutureDilutions}
            onSwitchToSimulator={() => setTool('simulator')} />
        </div>
        <div className={tool === 'simulator' ? 'space-y-4' : 'hidden'}>
          <p className="text-xs text-gray-500">
            The same math over <b>your own hypothetical numbers</b> — up to 3 what-if scenarios side by side, independent of any startup&apos;s registered data (you can prefill one from the startup selected on the left, then edit freely).
          </p>
          <EquitySimulatorTool cards={cards} selectedOrgId={selectedOrgId} />
        </div>
        <div className={tool === 'scorecard' ? 'block' : 'hidden'}>
          <ScorecardCriteriaTool />
        </div>
        <div className={tool === 'berkus' ? 'block' : 'hidden'}>
          <BerkusMethodTool cards={cards} selectedOrgId={selectedOrgId} />
        </div>
        <div className={tool === 'compare' ? 'block' : 'hidden'}>
          <CompareStartupsTool cards={cards} selectedOrgId={selectedOrgId} active={tool === 'compare'} />
        </div>
        <div className={tool === 'return' ? 'block' : 'hidden'}>
          <ScenariosReturnsTool cards={cards} selectedOrgId={selectedOrgId}
            ticket={ticket} setTicket={setTicket} basis={basis} setBasis={setBasis}
            futureDilutions={futureDilutions} setFutureDilutions={setFutureDilutions}
            onSwitchToSimulator={() => setTool('simulator')} />
        </div>
      </div>

      {/* Prompt 418 §A.4 — the tool strip moved here from a horizontal row
          above the center column into a vertical list of equal-width
          cards, same active-highlight style as before. */}
      <div className="flex flex-col gap-1.5">
        {TOOLS.map((t) => (
          <button key={t.key} onClick={() => setTool(t.key)}
            className={`w-full rounded-xl px-3 py-1.5 text-left ${tool === t.key ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <span className="block text-xs font-medium">{t.label}</span>
            <span className={`block text-[10px] ${tool === t.key ? 'text-white/70' : 'text-gray-400'}`}>{t.subtitle}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
