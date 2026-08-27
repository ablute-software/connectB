'use client';
// Prompt 202 §C — as últimas interações à vista na entity page, em vez de
// escondidas atrás de um botão. "Open thread" não se lê como "histórico de
// contactos", e o histórico é a função central da app: uma linha por
// interação (data · direcção · canal · primeira linha), com o histórico
// completo a um clique.
import { useEffect, useRef, useState } from 'react';
import type { Entity, InteractionEdit } from '@/lib/types';
import { useStore } from '@/lib/store';
import { derivedStage } from '@/lib/derived-stage';
import {
  firstLine, unclassifiedInbound, formatAsk, DIRECTION_LABEL,
  mergeTimeline, timelineContent, type DealMessageLike, type TimelineRow,
} from '@/lib/interaction-history';
import { SharedDocChip } from '@/components/SharedDocChip';
import { InlineClassify } from '@/components/InlineClassify';
import { EditInteractionDetails, InteractionEditHint } from '@/components/EditInteractionDetails';

export function RecentInteractions({ entity, onOpenFull, limit = 3, focusClassifyNonce = 0, focusInteraction, dealMessages = [] }: {
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
  // Prompt 238 — as mensagens Sherlock desta entidade (deal_messages),
  // fundidas com as interactions no mesmo histórico. Até aqui só contavam
  // para touchCount/lastTouchAt (RelationshipSummaryCard), nunca apareciam
  // aqui — um investidor real trocou 3 mensagens pela app e a lista
  // mostrava só 2 linhas ao lado de "5 touches", sem explicar a diferença.
  dealMessages?: DealMessageLike[];
}) {
  const { db } = useStore();
  const [expanded, setExpanded] = useState(false);
  // Prompt 231 §C — deixou de ser um portão para revelar o InlineClassify de
  // um item pendente (isso monta directamente agora, sem clique). Fica só
  // para o "Edit" de uma interação JÁ classificada — reabrir o formulário
  // pré-preenchido é a única vez que alguém escolhe entrar aqui.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Prompt 252 — separate from editingId (classification edit): fixing
  // occurred_at/channel/content is a different action, on a different
  // affordance, so it needs its own toggle instead of sharing one.
  const [editingDetailsId, setEditingDetailsId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const merged = mergeTimeline(db.interactions, entity.id, dealMessages);
  const all = [...merged].sort((a, b) => b.at.localeCompare(a.at));
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

  // Prompt 241 — a casca passa a ser a do cartão do 240 (gradiente
  // quase-branco, borda #e6eef0, sombra em duas camadas): este componente
  // deixou de viver solto por baixo e passou a OCUPAR a coluna direita do
  // RelationshipSummaryCard, como `historySlot`. É a mesma peça visual que
  // estava lá, agora com a classificação inline que só existia aqui.
  const CARD = 'rounded-2xl border border-[#e6eef0] bg-[linear-gradient(155deg,#ffffff,#f3fafb_70%)] px-4 py-3 shadow-[0_1px_1px_rgba(15,60,70,.04),0_6px_14px_-6px_rgba(15,60,70,.14),inset_0_1px_0_rgba(255,255,255,.6)]';

  if (total === 0) {
    return (
      <div data-tour-id="entity-history" className={`${CARD} text-sm text-gray-400`}>
        No contact history yet — nothing logged for {entity.name}.
      </div>
    );
  }

  return (
    <div data-tour-id="entity-history" className={CARD}>
      <div className="flex items-center justify-between gap-2">
        {/* Prompt 228 §A tinha tirado o titulo daqui porque o cartao de cima
            ja dizia "Contact history" e liam-se como repeticao. O 241
            removeu essa segunda lista — este e agora o unico historico da
            pagina, portanto o titulo volta: nao ha nada com que duplicar. */}
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
        {recent.map((row) => (
          row.kind === 'deal_message'
            ? <DealMessageRow key={row.key} row={row} rowRefs={rowRefs} highlighted={highlighted === row.key} />
            : (
              // highlighted/focusInteraction usam o id CRU da interaction
              // (ver o ref em InteractionRow), não o row.key namespaced.
              <InteractionRow key={row.key} row={row} rowRefs={rowRefs}
                pending={pending} highlighted={highlighted === row.interaction.id}
                editingId={editingId} setEditingId={setEditingId}
                editingDetailsId={editingDetailsId} setEditingDetailsId={setEditingDetailsId}
                edits={db.interactionEdits.filter((e) => e.interaction_id === row.interaction.id)} />
            )
        ))}
      </ul>
    </div>
  );
}

// Prompt 238 — uma mensagem Sherlock: sem canal, sem "ask", sem documento
// partilhado por Interaction.document_id (as suas próprias `documents` são
// outra forma), e sobretudo SEM controlos de classificação — uma mensagem
// da app não é uma "resposta por classificar" no sentido do 208 §D, é
// conversa já estruturada.
function DealMessageRow({ row, rowRefs, highlighted }: {
  row: Extract<TimelineRow, { kind: 'deal_message' }>;
  rowRefs: React.MutableRefObject<Record<string, HTMLLIElement | null>>;
  highlighted: boolean;
}) {
  const m = row.message;
  return (
    <li ref={(el) => { rowRefs.current[row.key] = el; }}
      className={`flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600 ${
        highlighted ? 'rounded border border-cyan-300 bg-cyan-50/60 p-1.5' : ''}`}>
      <span className="tabular-nums text-gray-400">{row.at.slice(0, 10)}</span>
      <span className={row.direction === 'in' ? 'font-medium text-blue-800' : 'font-medium text-cyan-900'}>
        {DIRECTION_LABEL[row.direction]}
      </span>
      <span className="text-gray-400">· Sherlock message</span>
      <span className="min-w-0 flex-1 truncate text-gray-700">{firstLine(timelineContent(row))}</span>
      {!!m.documents?.length && (
        <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
          📄 {m.documents.length}
        </span>
      )}
    </li>
  );
}

function InteractionRow({ row, rowRefs, pending, highlighted, editingId, setEditingId, editingDetailsId, setEditingDetailsId, edits }: {
  row: Extract<TimelineRow, { kind: 'interaction' }>;
  rowRefs: React.MutableRefObject<Record<string, HTMLLIElement | null>>;
  pending: ReturnType<typeof unclassifiedInbound>;
  highlighted: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editingDetailsId: string | null;
  setEditingDetailsId: (id: string | null) => void;
  edits: InteractionEdit[];
}) {
  const i = row.interaction;
  const isPending = pending.some((p) => p.id === i.id);
  // Prompt 231 §B — "já classificada" exclui 'awaiting': esse valor
  // fica em `pending` de propósito (é "responderam mas não é
  // decisão ainda"), e mostrar Edit ao lado do formulário pendente
  // seria dois controlos para a mesma linha.
  const isClassified = !!i.classification && !isPending;
  return (
    // Prompt 238 — ref pelo id CRU da interaction (não o `row.key`
    // namespaced): é esse id que oldestPending/focusInteraction (vindos de
    // unclassifiedInbound/db.interactions directamente) sabem procurar.
    <li ref={(el) => { rowRefs.current[i.id] = el; }}
      className={`flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600 ${
        isPending ? 'rounded border border-amber-300 bg-amber-50/50 p-1.5'
          : highlighted ? 'rounded border border-cyan-300 bg-cyan-50/60 p-1.5' : ''}`}>
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
      <InteractionAttachmentChips interactionId={i.id} documentId={i.document_id} occurredAt={i.occurred_at} />
      <InteractionEditHint edits={edits} />
      {/* Prompt 252 — fix a wrong date/channel/content, separate from the
          classification "Edit" below (a distinct pencil, not a second
          "Edit" label competing on the same row). */}
      {editingDetailsId !== i.id && (
        <button onClick={() => setEditingDetailsId(i.id)} title="Fix date, channel or content"
          className="text-[10px] text-gray-300 hover:text-[#0E7490]">
          ✎
        </button>
      )}
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
      {editingDetailsId === i.id && (
        <div className="w-full">
          <EditInteractionDetails interaction={i} onDone={() => setEditingDetailsId(null)} />
        </div>
      )}
    </li>
  );
}

// Prompt 397 §C.3 — N attachments per interaction (interaction_documents),
// on top of SharedDocChip's pre-existing SINGLE document_id chip. Falls back
// to SharedDocChip alone whenever there are no interaction_documents rows —
// every interaction logged before Phase C, or logged via /log's own
// single-doc "Material shared" field, has no join rows and keeps rendering
// exactly as before (one chip, from document_id, with its version label).
function InteractionAttachmentChips({ interactionId, documentId, occurredAt }: { interactionId: string; documentId?: string; occurredAt: string }) {
  const { db } = useStore();
  const rows = db.interactionDocuments.filter((d) => d.interaction_id === interactionId);
  if (rows.length === 0) return <SharedDocChip documentId={documentId} occurredAt={occurredAt} />;
  return (
    <>
      {rows.map((r) => r.document_id
        ? <SharedDocChip key={r.id} documentId={r.document_id} occurredAt={occurredAt} />
        : <FolderAttachmentChip key={r.id} folderId={r.folder_id} />)}
    </>
  );
}

function FolderAttachmentChip({ folderId }: { folderId?: string }) {
  const { db } = useStore();
  const folder = db.folders.find((f) => f.id === folderId);
  if (!folder) return null;
  return (
    <span title={`Shared folder: ${folder.name}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200">
      <span aria-hidden>📁</span>
      <span className="truncate">{folder.name}</span>
    </span>
  );
}
