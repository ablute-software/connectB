'use client';
// Prompt 208 §D — classificar onde a resposta está, e não noutro sítio.
//
// O chip "N to classify" levava a /log?entity=… — um formulário de interação
// NOVA, em branco, quando o inbound já estava registado. Convidava a
// duplicar em vez de resolver. E o Thread view, que era a alternativa, não
// assinalava qual era a resposta por classificar nem tinha controlo nenhum
// para a classificar.
//
// Este controlo vive nos dois sítios (Contact history e ThreadDrawer) para a
// resposta ser a mesma onde quer que o founder chegue primeiro. Chama o
// classifyInteraction que já existe — que já trata de pôr a entidade em
// 'passed' num pass e em 'in_conversation' numa resposta de interesse.
//
// Prompt 231 — decisão do Nuno: pedir um clique em "Classify with AI",
// depois escolher, depois gravar é fricção supérflua quando a AI já está
// configurada. Para uma resposta NOVA (sem `existing`), a AI corre e grava
// sozinha ao montar; o founder só entra pelo "Edit" que os chamadores
// mostram depois — e é aí, com `existing` preenchido, que este componente
// NUNCA corre sozinho: quem clicou Edit já está a rever de propósito.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { aiNeedsReview, type ClassifySuggestion } from '@/lib/classify-ai';
import type { Classification, PassReasonCategory } from '@/lib/types';

const CLASSIFICATIONS: Classification[] = [
  'awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear',
];
const PASS_CATS: PassReasonCategory[] = [
  'valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other',
];

// Prompt 231 §B — o que já está gravado, para reabrir pré-preenchido em vez
// de em branco. `classifiedBy` só para o badge "✨ AI" já aparecer correto
// ao reabrir uma classificação que a AI tinha feito.
export interface ExistingClassification {
  classification: Classification;
  passReasonCategory?: PassReasonCategory;
  passReason?: string;
  classifiedBy?: 'ai' | 'mechanical';
}

export function InlineClassify({ interactionId, content, onDone, existing }: {
  interactionId: string;
  // Prompt 208 §D.2 — o texto da propria resposta, para a AI poder ler. Sem
  // ele o botao de AI nao aparece (nao ha nada para classificar).
  content?: string;
  onDone?: () => void;
  existing?: ExistingClassification;
}) {
  const { classifyInteraction } = useStore();
  const [aiState, setAiState] = useState<'idle' | 'running' | 'done' | 'unavailable'>('idle');
  const [fromAi, setFromAi] = useState(existing?.classifiedBy === 'ai');
  const [choice, setChoice] = useState<Classification | ''>(existing?.classification ?? '');
  const [cat, setCat] = useState<PassReasonCategory>(existing?.passReasonCategory ?? 'other');
  const [reason, setReason] = useState(existing?.passReason ?? '');
  // Guarda contra o StrictMode montar/desmontar duas vezes em dev — sem
  // isto, uma resposta podia disparar duas classificações automáticas.
  const autoRan = useRef(false);

  async function classifyWithAi(autoSave: boolean) {
    if (!content) return;
    setAiState('running');
    try {
      const r = await fetch('/api/classify-interaction', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }),
      });
      const body = await r.json() as { configured?: boolean; suggestion?: ClassifySuggestion | null };
      if (!body.configured) { setAiState('unavailable'); return; }
      if (!body.suggestion) { setAiState('done'); return; }
      const s = body.suggestion;
      // Pre-selecciona sempre. O founder confirma no mesmo Save de sempre —
      // a AI sugere, quem decide continua a ser ele, EXCEPTO no caminho
      // automático abaixo, que é a própria decisão do Nuno neste prompt.
      setChoice(s.classification);
      if (s.passReasonCategory) setCat(s.passReasonCategory);
      if (s.passReason) setReason(s.passReason);
      setFromAi(true);
      setAiState('done');

      if (autoSave) {
        const isPass = s.classification === 'pass';
        const reasonText = (s.passReason ?? '').trim();
        // Um pass sem razão nunca se grava sozinho — a mesma regra
        // pass_requires_reason que o Save manual já respeita. Fica
        // pré-seleccionado com o resto do formulário aberto, e a IA já
        // devolve string vazia nesse caso (nunca inventa uma razão), por
        // isso isto não é um caso raro a tratar à parte.
        if (!isPass || reasonText.length > 0) {
          classifyInteraction(
            interactionId, s.classification,
            isPass ? (s.passReasonCategory ?? 'other') : undefined,
            isPass ? reasonText : undefined,
            'ai',
            aiNeedsReview(s) ? true : undefined,
          );
          onDone?.();
        }
      }
    } catch {
      setAiState('done');
    }
  }

  useEffect(() => {
    // Prompt 231 §A — reabrir por "Edit" (existing preenchido) NUNCA corre
    // sozinho: o founder já está aqui de propósito para rever, e disparar a
    // AI outra vez por baixo dele seria o oposto do que pediu. Só sonda se
    // a AI está configurada, para o botão de retry manual saber se aparece
    // — o mesmo papel que o probe original sempre teve.
    if (existing) {
      let alive = true;
      fetch('/api/classify-interaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '' }) })
        .then((r) => r.json())
        .then((b) => { if (alive && !b.configured) setAiState('unavailable'); })
        .catch(() => { if (alive) setAiState('unavailable'); });
      return () => { alive = false; };
    }
    // Resposta nova: corre sozinho assim que há texto — sem esperar clique.
    if (content && !autoRan.current) {
      autoRan.current = true;
      classifyWithAi(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A mesma regra do /log e da base de dados (pass_requires_reason): um pass
  // sem razão não se grava. Aqui é ainda mais importante que no formulário —
  // é a razão que faz o próximo pitch melhor.
  const passMissingReason = choice === 'pass' && reason.trim().length === 0;
  const canSave = choice !== '' && !passMissingReason;

  return (
    <div className="mt-1.5 w-full rounded border border-amber-200 bg-amber-50/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-amber-900">
          {aiState === 'running' ? 'Reading their reply…' : 'What did they say?'}
        </span>
        <select value={choice} onChange={(e) => setChoice(e.target.value as Classification)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]">
          <option value="" disabled>Choose…</option>
          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        {content && aiState !== 'unavailable' && (
          <button onClick={() => classifyWithAi(false)} disabled={aiState === 'running'}
            className="rounded-full border border-cyan-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0E7490] hover:bg-cyan-50 disabled:opacity-50">
            {aiState === 'running' ? 'Reading…' : '✨ Classify with AI'}
          </button>
        )}
        {fromAi && <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-900">✨ AI</span>}
        <button
          disabled={!canSave}
          onClick={() => {
            // Um pass sugerido pela AI grava com needs_review: muda o
            // status da entidade para 'passed', que e decisao a mais para
            // ficar so com a palavra do modelo, mesmo confirmada a correr.
            const suggestion = { classification: choice as Classification };
            classifyInteraction(interactionId, choice as Classification,
              choice === 'pass' ? cat : undefined,
              choice === 'pass' ? reason.trim() : undefined,
              fromAi ? 'ai' : undefined,
              fromAi && aiNeedsReview(suggestion) ? true : undefined);
            onDone?.();
          }}
          className="rounded-full bg-[#0E7490] px-2.5 py-0.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
          Save
        </button>
      </div>

      {choice === 'pass' && (
        <div className="mt-1.5 space-y-1.5">
          <select value={cat} onChange={(e) => setCat(e.target.value as PassReasonCategory)}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]">
            {PASS_CATS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Their reason, verbatim if possible — REQUIRED. Ten of these rewrite the pitch."
            className="w-full rounded border border-gray-300 p-1.5 text-[11px]" />
        </div>
      )}
    </div>
  );
}
