'use client';
// Prompt 212 §B.5 — antes de gravar um número da ronda, dizer onde ele vai
// aparecer.
//
// Não sincroniza nada: as superfícies já leem todas da mesma fonte. O que
// isto faz é tornar o alcance visível ANTES do clique, porque foi
// precisamente a invisibilidade do alcance que deixou os €100k de uma ronda
// antiga a circular como progresso desta.
//
// Overlay -> createPortal para document.body, pela regra do CLAUDE.md: um
// antecessor com backdrop-blur torna-se containing block de descendentes
// fixed e colapsa o overlay sem erro nem teste a falhar. Já aconteceu neste
// projecto.
import { createPortal } from 'react-dom';
import { propagationTargets, type RoundField } from '@/lib/round-propagation';

export function PropagationConfirm({ field, progressVisibleToInvestors, summary, onConfirm, onCancel }: {
  field: RoundField;
  progressVisibleToInvestors: boolean;
  // Uma linha a dizer o que muda ("Round target: €300,000 → €500,000").
  summary: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const targets = propagationTargets(field, { progressVisibleToInvestors });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-gray-900">This shows up in more than one place</h2>
        <p className="mt-1 text-xs text-gray-600">{summary}</p>

        <ul className="mt-3 space-y-1 text-xs text-gray-700">
          {targets.map((t) => (
            <li key={t} className="flex gap-1.5"><span className="text-gray-300">•</span>{t}</li>
          ))}
        </ul>

        {/* Honesto sobre o que o popup NÃO promete: só lista o que já é
            verdade. Se o toggle do progresso estiver desligado, o portal do
            investidor nem sequer aparece na lista acima. */}
        <p className="mt-3 text-[11px] text-gray-400">
          Everything reads from this one value — there&apos;s no second copy to update.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
