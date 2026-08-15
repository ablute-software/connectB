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
import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { Classification, PassReasonCategory } from '@/lib/types';

const CLASSIFICATIONS: Classification[] = [
  'awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear',
];
const PASS_CATS: PassReasonCategory[] = [
  'valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other',
];

export function InlineClassify({ interactionId, onDone }: { interactionId: string; onDone?: () => void }) {
  const { classifyInteraction } = useStore();
  const [choice, setChoice] = useState<Classification | ''>('');
  const [cat, setCat] = useState<PassReasonCategory>('other');
  const [reason, setReason] = useState('');

  // A mesma regra do /log e da base de dados (pass_requires_reason): um pass
  // sem razão não se grava. Aqui é ainda mais importante que no formulário —
  // é a razão que faz o próximo pitch melhor.
  const passMissingReason = choice === 'pass' && reason.trim().length === 0;
  const canSave = choice !== '' && !passMissingReason;

  return (
    <div className="mt-1.5 w-full rounded border border-amber-200 bg-amber-50/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-amber-900">What did they say?</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value as Classification)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]">
          <option value="" disabled>Choose…</option>
          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <button
          disabled={!canSave}
          onClick={() => {
            classifyInteraction(interactionId, choice as Classification,
              choice === 'pass' ? cat : undefined,
              choice === 'pass' ? reason.trim() : undefined);
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
