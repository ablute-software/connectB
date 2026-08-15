'use client';
// Prompt 202 §C — as últimas interações à vista na entity page, em vez de
// escondidas atrás de um botão. "Open thread" não se lê como "histórico de
// contactos", e o histórico é a função central da app: uma linha por
// interação (data · direcção · canal · primeira linha), com o histórico
// completo a um clique.
import { useState } from 'react';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import { derivedStage } from '@/lib/derived-stage';
import { firstLine, recentInteractions, formatAsk, DIRECTION_LABEL } from '@/lib/interaction-history';
import { SharedDocChip } from '@/components/SharedDocChip';

export function RecentInteractions({ entity, onOpenFull, limit = 3 }: {
  entity: Entity;
  // Prompt 206-B — continua a existir para quem vem da Pipeline (abrir o
  // drawer em vez de navegar para fora), mas deixou de ser a ÚNICA porta: na
  // página da entidade o histórico expande no próprio sítio.
  onOpenFull?: () => void;
  limit?: number;
}) {
  const { db } = useStore();
  const [expanded, setExpanded] = useState(false);
  const all = recentInteractions(db.interactions, entity.id, Number.MAX_SAFE_INTEGER);
  const recent = expanded ? all : all.slice(0, limit);
  const total = all.length;
  // Reutiliza a contagem do 206-A em vez de a recalcular: uma resposta por
  // classificar é a razão para o histórico chamar a atenção.
  const { unclassifiedReplies } = derivedStage(db, entity.id);

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-400 shadow-sm">
        No contact history yet — nothing logged for {entity.name}.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          Contact history
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{total}</span>
          {unclassifiedReplies > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
              {unclassifiedReplies} to classify
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {total > limit && (
            // Expande AQUI, empurrando o resto — o comportamento que o Nuno
            // descreveu. O drawer continua a existir, mas já não é a única
            // forma de ver o histórico completo.
            <button onClick={() => setExpanded((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                unclassifiedReplies > 0
                  ? 'bg-[#0E7490] text-white hover:bg-[#0c637b]'
                  : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {expanded ? 'Show less' : `Show all ${total}`}
            </button>
          )}
          {onOpenFull && (
            // "Thread view" e nao "Open thread": o drawer ja nao e a porta
            // para o historico (isso e o botao acima), e sim a vista com
            // filtro por pessoa e export que a lista compacta nao tem.
            <button onClick={onOpenFull} className="text-xs font-medium text-[#0E7490] hover:underline">
              Thread view
            </button>
          )}
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {recent.map((i) => (
          <li key={i.id} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600">
            <span className="tabular-nums text-gray-400">{i.occurred_at.slice(0, 10)}</span>
            <span className={i.direction === 'in' ? 'font-medium text-blue-800' : 'font-medium text-cyan-900'}>
              {DIRECTION_LABEL[i.direction]}
            </span>
            <span className="text-gray-400">· {i.channel.replace(/_/g, ' ')}</span>
            <span className="min-w-0 flex-1 truncate text-gray-700">{firstLine(i.content)}</span>
            {formatAsk(i.ask_amount_eur) && (
              <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
                asked {formatAsk(i.ask_amount_eur)}
              </span>
            )}
            <SharedDocChip documentId={i.document_id} occurredAt={i.occurred_at} />
          </li>
        ))}
      </ul>
    </div>
  );
}
