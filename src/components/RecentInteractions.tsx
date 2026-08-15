'use client';
// Prompt 202 §C — as últimas interações à vista na entity page, em vez de
// escondidas atrás de um botão. "Open thread" não se lê como "histórico de
// contactos", e o histórico é a função central da app: uma linha por
// interação (data · direcção · canal · primeira linha), com o histórico
// completo a um clique.
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import { firstLine, recentInteractions, formatAsk, DIRECTION_LABEL } from '@/lib/interaction-history';
import { SharedDocChip } from '@/components/SharedDocChip';

export function RecentInteractions({ entity, onOpenFull, limit = 3 }: {
  entity: Entity; onOpenFull?: () => void; limit?: number;
}) {
  const { db } = useStore();
  const recent = recentInteractions(db.interactions, entity.id, limit);
  const total = db.interactions.filter((i) => i.entity_id === entity.id).length;

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-400 shadow-sm">
        No contact history yet — nothing logged for {entity.name}.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Contact history</h2>
        {onOpenFull && (
          <button onClick={onOpenFull} className="text-xs font-medium text-[#0E7490] hover:underline">
            View full history{total > recent.length ? ` (${total})` : ''}
          </button>
        )}
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
