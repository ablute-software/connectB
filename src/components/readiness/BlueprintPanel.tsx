'use client';
// Prompt 219 bloco 3 §3/§4 (Prompt 223) — o separador Pitch Blueprint.
//
// Duas metades, na ordem em que o founder as encontra:
//   1. O INTERROGATÓRIO (§3) — uma lacuna de cada vez, com as opções e o
//      campo livre do templateFor. O fluxo PARA na pergunta: responder
//      grava um claim aceite e passa à seguinte.
//   2. A ACEITAÇÃO (§4) — os claims que a ingestão propôs (o que já
//      existia), para aceitar, editar ou rejeitar, como os canon facts.
//
// Sem AI (bloco 4) e sem gating de tier (bloco 6). A UI só desenha; toda a
// classificação vive no servidor, sobre as funções puras dos blocos 1 e 2.
import { useEffect, useState } from 'react';
import { ReconciliationBusyNotice } from './ReconciliationBusyNotice';
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { CompanyClaim, ClaimCategory } from '@/lib/types';
import { GapInterrogation, type GapView } from './GapInterrogation';
import { KnowledgeHealthPanel } from './KnowledgeHealthPanel';
import { isWastedStrongClaim, claimsNeedingStrengthening } from '@/lib/company-claims';
import { pickCurrentGap } from '@/lib/gap-rotation';
import { GAP_QUESTION_BUDGET } from '@/lib/company-gaps';

interface BlueprintState {
  available: boolean;
  analysesAvailable?: boolean;
  claims: CompanyClaim[];
  gaps: GapView[];
  analysis: { id: string; status: string; started_at: string } | null;
}

const CATEGORIES: ClaimCategory[] = [
  'problema', 'solucao', 'prova_tecnica', 'validacao_externa',
  'tracao_gtm', 'equipa', 'mercado_timing', 'funding', 'ask',
];

// A hierarquia do bloco 1, em palavras — o número sozinho não diz nada a
// quem não leu o prompt, e é a coisa mais importante do ecrã.
const CLASS_LABEL: Record<number, string> = {
  1: 'Paid commitment', 2: 'External validation', 3: 'Team',
  4: 'Mechanism', 5: 'Decoration',
};
const CLASS_STYLE: Record<number, string> = {
  1: 'bg-emerald-100 text-emerald-800', 2: 'bg-cyan-100 text-cyan-800',
  3: 'bg-blue-100 text-blue-800', 4: 'bg-gray-100 text-gray-600',
  5: 'bg-amber-100 text-amber-800',
};

// Prompt 299 §1 — "safe to accept in bulk", never "accept everything".
// specificity high + a verifiable source (already linked to a document, or
// an already-confirmed company_facts row elsewhere — knowledgeToAtoms only
// ever turns a CONFIRMED fact into a 'fact'-sourced atom, so sourceKind
// alone already carries that guarantee, never re-checked here). The
// isWastedStrongClaim exclusion is redundant with specificity==='high' on
// its own, but stated explicitly per the prompt's own emphasis — exactly
// what G2 already flags as wasted strength must never be pre-marked.
function isSafeBulkCandidate(c: CompanyClaim): boolean {
  return c.specificity === 'high' && (c.sourceKind === 'vault_doc' || c.sourceKind === 'fact') && !isWastedStrongClaim(c);
}

// Prompt 313 §B — the founder-visible half of document_refs: which real
// Vault file (and page, if known) backs this claim. Links to the Vault list
// rather than a specific-document deep link — no such route exists yet, and
// building one is out of scope here.
function DocumentRefsBadge({ refs }: { refs: CompanyClaim['documentRefs'] }) {
  if (!refs || refs.length === 0) return null;
  return (
    <p className="mt-1 text-[11px] text-emerald-700">
      Backed by:{' '}
      {refs.map((r, i) => (
        <span key={r.documentId}>
          {i > 0 && ', '}
          <Link href="/documents" className="underline hover:no-underline">
            {r.documentName}{r.page != null ? ` (p. ${r.page})` : ''}
          </Link>
        </span>
      ))}
    </p>
  );
}

export function BlueprintPanel() {
  const [state, setState] = useState<BlueprintState | null>(null);
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ statement: string; category: string }>({ statement: '', category: 'solucao' });
  const [error, setError] = useState<string | null>(null);
  // Prompt 358 Phase 2.3 — same "never silent" note as ReviewPanel.tsx.
  const [routingNote, setRoutingNote] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Prompt 309 — same "Skip this one" fix as ReviewPanel.tsx (shares this
  // exact GapInterrogation flow): dismissing never writes a claim, so
  // without this the same gap just came right back as gaps[0]. Session-
  // local rotation only — never a persisted dismissal.
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  // Prompt 358 Phase 3.2 — same budget cap as ReviewPanel.tsx's own copy.
  const [showAllGaps, setShowAllGaps] = useState(false);

  function load() {
    fetch('/api/blueprint').then((r) => r.json()).then((body) => {
      // Prompt 480 §6 — another run held this org's lock; the data below
      // is complete, only the freshest matching pass is missing.
      setReconciliationBusy(!!body?.reconciliationSkipped);
      setState(body);
    }).catch(() => setState(null));
  }
  useEffect(load, []);

  // Prompt 299 §1 — pre-select the safe candidates whenever the proposed
  // queue changes (a fresh analysis run, or a claim leaving the queue via
  // accept/reject/edit) — always still editable before confirming, never
  // auto-submitted. Keyed on the actual proposed ids so re-selecting only
  // happens when the SET changes, not on every unrelated re-render.
  const proposedIdsKey = (state?.claims ?? []).filter((c) => c.status === 'proposed').map((c) => c.id).join(',');
  useEffect(() => {
    const proposedNow = (state?.claims ?? []).filter((c) => c.status === 'proposed');
    setSelectedIds(new Set(proposedNow.filter(isSafeBulkCandidate).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposedIdsKey]);

  async function runAnalysis() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/blueprint', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) setError(body.error ?? 'Something went wrong.');
      load();
    } finally { setBusy(false); }
  }

  const allGaps = state?.gaps ?? [];
  const budgetedGaps = showAllGaps ? allGaps : allGaps.slice(0, GAP_QUESTION_BUDGET);
  const gap = pickCurrentGap(budgetedGaps, skippedKeys);

  async function submitAnswer(opts: { option?: string; answer?: string; dismissed: boolean; category?: string }) {
    if (!gap) return;
    if (opts.dismissed) setSkippedKeys((prev) => new Set(prev).add(gap.key));
    setBusy(true); setError(null); setRoutingNote(null);
    try {
      const res = await fetch('/api/blueprint/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gapKey: gap.key, rule: gap.rule, option: opts.option, answer: opts.answer, category: opts.category,
          analysisId: state?.analysis?.id, dismissed: opts.dismissed, relatedClaimIds: gap.relatedClaimIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); throw new Error(body.error ?? 'Something went wrong.'); }
      if (body.routedAs === 'amend_target_claim') setRoutingNote('Added to the existing claim rather than creating a new one.');
      load();
      // Prompt 363 — G1/G6 can legitimately stay open after an honest,
      // saved answer; GapInterrogation needs this to show the "already told
      // us" mode instead of a blank form for the same question.
      return { stillOpen: body.stillOpen as boolean | undefined, reason: body.reason as string | undefined };
    } finally { setBusy(false); }
  }

  // Prompt 358 Phase 1 — same attach-document flow as ReviewPanel.tsx's own
  // copy (never a text claim for G4's "Yes — I will attach it").
  async function attachDocument(claimId: string, documentId: string) {
    if (!gap) return;
    setBusy(true); setError(null);
    try {
      await fetch('/api/blueprint/link-document', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId, documentId, gapKey: gap.key, analysisId: state?.analysis?.id }),
      });
      load();
    } finally { setBusy(false); }
  }

  // Prompt 358 Phase 2.1 — same one-click reconciliation reply as
  // ReviewPanel.tsx's own copy.
  async function reconcileConfirm(claimId: string, confirm: boolean) {
    setBusy(true); setError(null);
    try {
      await fetch('/api/blueprint/reconcile-confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId, confirm }),
      });
      load();
    } finally { setBusy(false); }
  }

  async function claimAction(id: string, action: 'accept' | 'reject' | 'edit') {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/blueprint/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'edit'
          ? { id, action, statement: editDraft.statement, category: editDraft.category }
          : { id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); return; }
      setEditingId(null);
      load();
    } finally { setBusy(false); }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkAction(action: 'accept' | 'reject', ids: string[]) {
    if (ids.length === 0) return;
    setBulkBusy(true); setError(null);
    try {
      const res = await fetch('/api/blueprint/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); return; }
      load();
    } finally { setBulkBusy(false); }
  }

  if (state === null) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!state.available) {
    return (
      <Card title="Pitch Blueprint">
        <p className="text-sm text-gray-500">
          The narrative engine isn&apos;t switched on for this workspace yet.
        </p>
      </Card>
    );
  }

  const proposed = state.claims.filter((c) => c.status === 'proposed');
  const accepted = state.claims.filter((c) => c.status === 'accepted');

  return (
    <div className="space-y-4">
      <ReconciliationBusyNotice show={reconciliationBusy} />
      <Card title="Pitch Blueprint">
        <p className="text-xs text-gray-500">
          Reads everything the workspace already knows about your company — confirmed facts, profile, roadmap,
          team, previous rounds, document names — and turns it into claims, ranked by how hard they are to fake.
          Then it asks about what&apos;s missing.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={runAnalysis} disabled={busy}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {busy ? 'Working…' : state.claims.length === 0 ? 'Run first analysis' : 'Re-read my company'}
          </button>
          <span className="text-xs text-gray-400">
            {accepted.length} confirmed · {proposed.length} to review · {state.gaps.length} question(s) waiting
          </span>
        </div>
        {!state.analysesAvailable && (
          <p className="mt-1.5 text-[11px] text-amber-700">
            Analyses aren&apos;t being recorded yet (migration pending) — claims and questions still work.
          </p>
        )}
        {error && <p className="mt-1.5 text-xs text-[#B00000]">{error}</p>}
      </Card>

      {/* §3 — o interrogatório: uma pergunta de cada vez (GapInterrogation,
          shared with ReviewPanel.tsx — Prompt 298 §1). Prompt 358 Phase 3.1 —
          the Knowledge Health panel replaces the old "N left" framing;
          Phase 3.2's budget caps which gaps the flow below can pull from. */}
      {(allGaps.length > 0 || state.claims.some((c) => c.status === 'accepted')) && (
        <Card title={<span className="text-[#0E7490]">Knowledge health</span>}>
          <KnowledgeHealthPanel claims={state.claims} gaps={allGaps} />
          {gap && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {routingNote && <p className="mb-2 text-xs text-[#0E7490]">{routingNote}</p>}
              <GapInterrogation key={gap.key} gap={gap} remaining={budgetedGaps.length} busy={busy}
                onSubmit={submitAnswer} onAttachDocument={attachDocument} onReconcileConfirm={reconcileConfirm} />
            </div>
          )}
          {!showAllGaps && allGaps.length > budgetedGaps.length && (
            <button onClick={() => setShowAllGaps(true)} className="mt-2 text-xs text-[#0E7490] hover:underline">
              Ask me more ({allGaps.length - budgetedGaps.length} more available)
            </button>
          )}
        </Card>
      )}

      {/* Prompt 374 §A — see StrengthenClaimsPanel's own header: the full
          panel now lives only in the Action plan tab. */}
      {claimsNeedingStrengthening(state.claims) > 0 && (
        <Link href="/readiness?tab=plan"
          className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-600 hover:border-[#0E7490] hover:text-[#0E7490]">
          {claimsNeedingStrengthening(state.claims)} claim{claimsNeedingStrengthening(state.claims) === 1 ? '' : 's'} could be stronger — fix in Action plan →
        </Link>
      )}

      {/* §4 — aceitação dos claims propostos. Prompt 299 §1 — bulk COM
          critério: seleção múltipla sempre disponível, mas as claims
          "seguras" (specificity alta + fonte verificável) vêm pré-marcadas
          — nunca "aceitar tudo" com um clique só. */}
      {proposed.length > 0 && (
        <Card title={`To review (${proposed.length})`}>
          <p className="mb-2 text-xs text-gray-500">
            Nothing here reaches any investor-facing surface until you accept it. Pre-checked items are high-specificity
            claims already backed by a document or a confirmed fact — still yours to uncheck before confirming.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
            <button onClick={() => setSelectedIds(new Set(proposed.map((c) => c.id)))} className="text-xs text-[#0E7490] hover:underline">
              Select all
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:underline">
              Select none
            </button>
            <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => bulkAction('accept', [...selectedIds])} disabled={bulkBusy || selectedIds.size === 0}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                {bulkBusy ? 'Working…' : `Accept selected (${selectedIds.size})`}
              </button>
              <button onClick={() => bulkAction('reject', [...selectedIds])} disabled={bulkBusy || selectedIds.size === 0}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                Reject selected
              </button>
            </div>
          </div>
          <ul className="space-y-2">
            {proposed.map((c) => (
              <li key={c.id} className="flex gap-2 rounded-lg border border-gray-100 p-2.5">
                {editingId !== c.id && (
                  <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelected(c.id)}
                    className="mt-1 shrink-0" />
                )}
                <div className="flex-1">
                {editingId === c.id ? (
                  <>
                    <textarea value={editDraft.statement} onChange={(e) => setEditDraft({ ...editDraft, statement: e.target.value })}
                      rows={2} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <select value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
                        {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                      <button onClick={() => claimAction(c.id, 'edit')} disabled={busy}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save &amp; accept</button>
                      <button onClick={() => setEditingId(null)}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                      <span className="text-[11px] text-gray-400">Strength is re-measured from the new wording.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 text-sm text-gray-800">{c.statement}</p>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASS_STYLE[c.evidenceClass]}`}>
                        {CLASS_LABEL[c.evidenceClass]}
                      </span>
                    </div>
                    {/* Prompt 311 §C — the ablute_ real case: the same
                        decoration-class fact (an award, a prize) said 4
                        different ways, never linked. Not general dedup —
                        just this one narrow, already-computed signal (see
                        findDuplicateCandidate's own header) — surfaced here
                        so the founder can decide keep/reject in one look
                        instead of reconciling several claims on their own. */}
                    {c.possibleDuplicateOf && (
                      <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
                        <p className="font-medium text-amber-800">Possible duplicate — you may have already said this:</p>
                        <p className="mt-0.5 text-amber-900">&quot;{c.possibleDuplicateOf.statement}&quot;</p>
                      </div>
                    )}
                    <DocumentRefsBadge refs={c.documentRefs} />
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                      <span>{c.category}</span>
                      <span>· {c.specificity} detail</span>
                      <span>· from {c.sourceKind}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button onClick={() => claimAction(c.id, 'accept')} disabled={busy}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Accept</button>
                      <button onClick={() => { setEditingId(c.id); setEditDraft({ statement: c.statement, category: c.category }); }}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Edit</button>
                      <button onClick={() => claimAction(c.id, 'reject')} disabled={busy}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40">Reject</button>
                    </div>
                  </>
                )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {accepted.length > 0 && (
        <Card title={`Confirmed claims (${accepted.length})`}>
          <ul className="space-y-1.5">
            {accepted.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASS_STYLE[c.evidenceClass]}`}>
                  {CLASS_LABEL[c.evidenceClass]}
                </span>
                <span className="flex-1 text-gray-800">
                  {c.statement}
                  <DocumentRefsBadge refs={c.documentRefs} />
                </span>
                <span className="shrink-0 text-[11px] text-gray-400">{c.specificity}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {state.claims.length === 0 && state.gaps.length === 0 && (
        <Card title="Nothing yet">
          <p className="text-sm text-gray-400">Run the first analysis to see what your company already says — and what it doesn&apos;t.</p>
        </Card>
      )}
    </div>
  );
}
