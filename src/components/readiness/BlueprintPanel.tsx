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
import { Card } from '@/components/ui';
import type { CompanyClaim, ClaimCategory } from '@/lib/types';
import { GapInterrogation, type GapView } from './GapInterrogation';

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

export function BlueprintPanel() {
  const [state, setState] = useState<BlueprintState | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ statement: string; category: string }>({ statement: '', category: 'solucao' });
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch('/api/blueprint').then((r) => r.json()).then(setState).catch(() => setState(null));
  }
  useEffect(load, []);

  async function runAnalysis() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/blueprint', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) setError(body.error ?? 'Something went wrong.');
      load();
    } finally { setBusy(false); }
  }

  const gap = state?.gaps?.[0];

  async function submitAnswer(opts: { option?: string; answer?: string; dismissed: boolean }) {
    if (!gap) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/blueprint/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gapKey: gap.key, rule: gap.rule, option: opts.option, answer: opts.answer,
          analysisId: state?.analysis?.id, dismissed: opts.dismissed,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); return; }
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
          shared with ReviewPanel.tsx — Prompt 298 §1). */}
      {gap && (
        <Card title={<span className="text-[#0E7490]">What&apos;s missing ({state.gaps.length} left)</span>}>
          <GapInterrogation gap={gap} remaining={state.gaps.length} busy={busy} onSubmit={submitAnswer} />
        </Card>
      )}

      {/* §4 — aceitação dos claims propostos. */}
      {proposed.length > 0 && (
        <Card title={`To review (${proposed.length})`}>
          <p className="mb-2 text-xs text-gray-500">
            Nothing here reaches any investor-facing surface until you accept it.
          </p>
          <ul className="space-y-2">
            {proposed.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-100 p-2.5">
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
                <span className="flex-1 text-gray-800">{c.statement}</span>
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
