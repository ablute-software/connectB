'use client';
// Prompt 202 §C — as últimas interações à vista na entity page, em vez de
// escondidas atrás de um botão. "Open thread" não se lê como "histórico de
// contactos", e o histórico é a função central da app: uma linha por
// interação (data · direcção · canal · primeira linha), com o histórico
// completo a um clique.
import { useEffect, useRef, useState } from 'react';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import { derivedStage } from '@/lib/derived-stage';
import { firstLine, recentInteractions, unclassifiedInbound, formatAsk, DIRECTION_LABEL } from '@/lib/interaction-history';
import { SharedDocChip } from '@/components/SharedDocChip';
import { InlineClassify } from '@/components/InlineClassify';

export function RecentInteractions({ entity, onOpenFull, limit = 3, focusClassifyNonce = 0, focusInteraction, expandNonce = 0 }: {
  entity: Entity;
  // Prompt 206-B — continua a existir para quem vem da Pipeline (abrir o
  // drawer em vez de navegar para fora), mas deixou de ser a ÚNICA porta: na
  // página da entidade o histórico expande no próprio sítio.
  onOpenFull?: () => void;
  limit?: number;
  // Prompt 208 §D — o chip "N to classify" do cartão incrementa isto; aqui
  // expande-se o histórico e faz-se scroll até à resposta por classificar
  // mais antiga. Um contador e não um booleano para o mesmo pedido poder ser
  // feito duas vezes seguidas.
  focusClassifyNonce?: number;
  // Prompt 209 — ancora vinda do badge de documentos do stepper: expande o
  // historico, faz scroll ate essa interacao e destaca-a por uns segundos.
  focusInteraction?: { id: string; nonce: number };
  // Prompt 226 §2 — "Show all N" a partir do cartao de historico.
  expandNonce?: number;
}) {
  const { db } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const all = recentInteractions(db.interactions, entity.id, Number.MAX_SAFE_INTEGER);
  const total = all.length;
  const pending = unclassifiedInbound(db.interactions, entity.id);
  const oldestPending = pending[0];
  // Reutiliza a contagem do 206-A em vez de a recalcular: uma resposta por
  // classificar é a razão para o histórico chamar a atenção.
  const { unclassifiedReplies } = derivedStage(db, entity.id);

  // Prompt 226 §2 — o "Show all N" migrou para o cartao do
  // RelationshipSummaryCard, mas o estado `expanded` e daqui; um contador
  // (nao um booleano) pela mesma razao dos outros: pedir duas vezes tem de
  // funcionar duas vezes.
  useEffect(() => {
    if (expandNonce === 0) return;
    setExpanded(true);
    const id = window.setTimeout(() => {
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [expandNonce]);

  useEffect(() => {
    if (focusClassifyNonce === 0 || !oldestPending) return;
    setExpanded(true);
    setClassifying(oldestPending.id);
    // Depois do expand, o elemento existe no DOM no frame seguinte.
    const id = window.setTimeout(() => {
      rowRefs.current[oldestPending.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [focusClassifyNonce, oldestPending?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusInteraction?.nonce || !focusInteraction.id) return;
    setExpanded(true);
    setHighlighted(focusInteraction.id);
    const t = window.setTimeout(() => {
      rowRefs.current[focusInteraction.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    // O destaque apaga-se sozinho: serve para o olho encontrar a linha, nao
    // para ficar la a marca-la.
    const clear = window.setTimeout(() => setHighlighted(null), 4000);
    return () => { window.clearTimeout(t); window.clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusInteraction?.nonce]);

  const recent = expanded ? all : all.slice(0, limit);

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-400 shadow-sm">
        No contact history yet — nothing logged for {entity.name}.
      </div>
    );
  }

  return (
    <div ref={listRef} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        {/* Prompt 228 §A — o titulo saiu daqui POR COMPLETO. O 226 tinha-o
            trocado de "Contact history" para "All contact", mas continuava a
            ler-se como repeticao: e a mesma ideia com outra palavra, logo
            debaixo do cartao que ja diz "Contact history". Ficam a contagem
            e o chip de "to classify", que sao o ESTADO desta lista e nao um
            titulo. */}
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{total}</span>
          {unclassifiedReplies > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
              {unclassifiedReplies} to classify
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {total > limit && (
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
        {recent.map((i) => {
          const needsClassifying = pending.some((p) => p.id === i.id);
          return (
            <li key={i.id} ref={(el) => { rowRefs.current[i.id] = el; }}
              className={`flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600 ${
                needsClassifying ? 'rounded border border-amber-300 bg-amber-50/50 p-1.5'
                  : highlighted === i.id ? 'rounded border border-cyan-300 bg-cyan-50/60 p-1.5' : ''}`}>
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
              {needsClassifying && classifying !== i.id && (
                <button onClick={() => setClassifying(i.id)}
                  className="whitespace-nowrap rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-300">
                  to classify
                </button>
              )}
              {classifying === i.id && (
                <InlineClassify interactionId={i.id} content={i.content} onDone={() => setClassifying(null)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
