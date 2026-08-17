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

export function RecentInteractions({ entity, onOpenFull, limit = 3, focusClassifyNonce = 0, focusInteraction }: {
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
}) {
  const { db } = useStore();
  const [expanded, setExpanded] = useState(false);
  // Prompt 231 §C — deixou de ser um portão para revelar o InlineClassify de
  // um item pendente (isso monta directamente agora, sem clique). Fica só
  // para o "Edit" de uma interação JÁ classificada — reabrir o formulário
  // pré-preenchido é a única vez que alguém escolhe entrar aqui.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const all = recentInteractions(db.interactions, entity.id, Number.MAX_SAFE_INTEGER);
  const total = all.length;
  const pending = unclassifiedInbound(db.interactions, entity.id);
  const oldestPending = pending[0];
  // Reutiliza a contagem do 206-A em vez de a recalcular: uma resposta por
  // classificar é a razão para o histórico chamar a atenção.
  const { unclassifiedReplies } = derivedStage(db, entity.id);

  useEffect(() => {
    if (focusClassifyNonce === 0 || !oldestPending) return;
    setExpanded(true);
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
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
          {/* Prompt 229 §A — "Show all N" deixa de expandir esta lista no
              proprio sitio e passa a abrir o MESMO drawer que o "Thread
              view". Esta seccao e o historico COMPACTO (3 mais recentes) e
              deve continuar a se-lo; ver tudo e trabalho do drawer, que tem
              filtro por pessoa e export.
              `expanded` continua a existir, mas so para o que ja fazia
              noutro sitio: saltar/realcar uma interacao especifica vinda do
              "to classify" ou do badge de documento — isso e diferente de
              "mostrar tudo" e nao muda. */}
          {/* Prompt 236 — "Show all N" e "Thread view" chamavam o MESMO
              handler (onOpenFull) desde o 229: dois botões para uma acção
              só. Fundidos num, com a contagem no label — é o que ajuda a
              decidir se vale a pena abrir. Já não depende de `total >
              limit`: abrir a vista completa faz sentido mesmo com poucas
              interações. */}
          {onOpenFull && (
            <button onClick={onOpenFull}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
              {`Thread view (${total})`}
            </button>
          )}
          {/* Prompt 232 — consequencia do 229 §A: um salto por "to classify"
              ou pelo badge de documento poe `expanded=true` para trazer o
              alvo a vista, mas sem este botao nao havia como voltar aos 3
              sem sair da pagina. So aparece nesse caso. */}
          {expanded && (
            <button onClick={() => setExpanded(false)}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
              Show less
            </button>
          )}
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {recent.map((i) => {
          const isPending = pending.some((p) => p.id === i.id);
          // Prompt 231 §B — "já classificada" exclui 'awaiting': esse valor
          // fica em `pending` de propósito (é "responderam mas não é
          // decisão ainda"), e mostrar Edit ao lado do formulário pendente
          // seria dois controlos para a mesma linha.
          const isClassified = !!i.classification && !isPending;
          return (
            <li key={i.id} ref={(el) => { rowRefs.current[i.id] = el; }}
              className={`flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600 ${
                isPending ? 'rounded border border-amber-300 bg-amber-50/50 p-1.5'
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
              {/* Prompt 231 §C — o item pendente monta o InlineClassify
                  DIRETAMENTE: a AI corre e grava sozinha assim que há texto,
                  sem esperar por um clique que só existia para o revelar. */}
              {isPending && <InlineClassify interactionId={i.id} content={i.content} />}
              {/* §B — uma vez classificada (incluindo pela AI sozinha), a
                  linha ganha "Edit" em vez de ficar muda. Reabre o MESMO
                  InlineClassify, pré-preenchido, para corrigir sem procurar
                  outro sítio. */}
              {isClassified && editingId !== i.id && (
                <button onClick={() => setEditingId(i.id)}
                  className="whitespace-nowrap text-[10px] font-medium text-gray-400 hover:text-[#0E7490] hover:underline">
                  Edit
                </button>
              )}
              {editingId === i.id && (
                <InlineClassify interactionId={i.id} content={i.content} onDone={() => setEditingId(null)}
                  existing={{
                    classification: i.classification!, passReasonCategory: i.pass_reason_category,
                    passReason: i.pass_reason, classifiedBy: i.classified_by,
                  }} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
