'use client';
// Prompt 209 — o stepper como jornada com desfecho, na variante que o Nuno
// aprovou. Desenha o que o journeySteps() (206-C, puro e testado) decide;
// aqui não há regra de negócio nenhuma.
//
// Activo: percorrido = teal claro com ✓, actual = teal cheio, futuro = cinza.
// Fechado: só os passos dados, terminando no desfecho — sem Meeting/Diligence
// cinzentos a seguir, que era o ruído a seguir a uma relação terminada.
// Parqueado: percorrido esmaecido mas legível, chip ❄ no fim.
import { Fragment, useState } from 'react';
import type { Entity, RelationshipStage } from '@/lib/types';
import { useStore } from '@/lib/store';
import { STAGE_LABEL } from '@/lib/relationship';
import { journeySteps, docsByStage, type StageDoc } from '@/lib/journey';
import { DocPreviewModal } from '@/components/DocPreviewModal';
import { DocBadgePopover } from '@/components/DocBadgePopover';

export function JourneyStepper({ entity, onViewInHistory }: {
  entity: Entity;
  // Prompt 209 — a segunda acção do popover: "ver no histórico" ancora na
  // interação onde a partilha consta. Quem sabe desenhar o histórico é o
  // RecentInteractions, portanto isto sobe à página da entidade.
  onViewInHistory?: (interactionId: string) => void;
}) {
  const { db } = useStore();
  // Prompt 215 — guarda o rectangulo do badge no momento do clique. O
  // popover deixou de viver dentro do cartao (onde era clipado pelo
  // overflow) e passa a flutuar ancorado a estas coordenadas.
  const [openAt, setOpenAt] = useState<{ stage: RelationshipStage; rect: DOMRect } | null>(null);
  const [preview, setPreview] = useState<{ docId: string; at: string } | null>(null);

  const steps = journeySteps(db, entity.id);
  const docs = docsByStage(db, entity.id);
  const parked = steps.some((s) => s.kind === 'parked');

  function docName(id: string) {
    return db.documents.find((d) => d.id === id)?.name ?? 'Document';
  }
  function hoverTitle(list: StageDoc[]) {
    return list.map((d) => `${docName(d.documentId)} · ${d.at.slice(0, 10)}`).join('\n');
  }

  const previewDoc = preview ? db.documents.find((d) => d.id === preview.docId) : undefined;

  return (
    // Prompt 226 §1 — `flex-wrap` deixava o "Decision" cair sozinho para uma
    // 2ª linha quando a coluna de cartões do 225 disputava a largura. Com
    // `flex-nowrap` o trilho é uma linha e ponto; quem trata do caso de não
    // caber é o `overflow-x-auto` do contentor, em RelationshipSummaryCard.
    <div className="flex flex-nowrap items-center gap-2 pb-1">
      {steps.map((step, idx) => {
        // Prompt 224 §3 — o conector substitui a seta de texto: um traço que
        // ESTICA (flex-1), para o trilho deixar de se agarrar à esquerda e
        // passar a ocupar a largura do cartão. Fica irmão dos pills no flex
        // exterior (não dentro de cada passo, como a seta estava), que é o
        // que lhe permite crescer. O troço a seguir a um passo percorrido
        // fica teal — reforça "até aqui, concluído" sem inventar fonte de
        // verdade nenhuma: é o `state` que o journeySteps() já devolve.
        const connector = idx < steps.length - 1 ? (
          <span aria-hidden
            className={`mx-1 h-px min-w-[12px] flex-1 ${
              step.kind === 'stage' && step.state === 'done' && !parked ? 'bg-[#0E7490]/30' : 'bg-gray-200'}`} />
        ) : null;

        if (step.kind === 'parked') {
          // Prompt 249 §B — clickable only when journeySteps() found an
          // actual interaction to anchor to (today: never — see that
          // function's own comment). Plain <span> when there's nothing to
          // jump to, same as before; a <button> with identical classes when
          // there is, so the chip's own color carries the affordance
          // instead of adding visual weight.
          const clickable = !!step.interactionId && !!onViewInHistory;
          const parkedClasses = 'whitespace-nowrap rounded-full border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600';
          const label = `❄ Parked${step.revisitAt ? ` — revisit ${step.revisitAt.slice(0, 10)}` : ''}`;
          return (
            <Fragment key="parked">
              {clickable ? (
                <button onClick={() => onViewInHistory!(step.interactionId!)} className={`${parkedClasses} cursor-pointer hover:bg-gray-100`}>
                  {label}
                </button>
              ) : (
                <span className={parkedClasses}>{label}</span>
              )}
              {connector}
            </Fragment>
          );
        }

        if (step.kind === 'outcome') {
          const declined = step.outcome === 'declined';
          const title = step.at ? `${declined ? 'passed' : 'invested'} ${step.at.slice(0, 10)}${step.passCategory ? ` — ${step.passCategory.replace(/_/g, ' ')}` : ''}` : undefined;
          const outcomeClasses = `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-white ${declined ? 'bg-[#B00000]' : 'bg-green-700'}`;
          // Prompt 249 §B — same pattern as the doc badge (📄): clicking
          // jumps the history to the interaction that IS the evidence for
          // this outcome (the classified pass reply). Only 'declined' can
          // have one today — see journeySteps()'s comment on why 'invested'
          // never does yet.
          const clickable = !!step.interactionId && !!onViewInHistory;
          return (
            <Fragment key="outcome">
              {clickable ? (
                <button onClick={() => onViewInHistory!(step.interactionId!)} title={title} className={`${outcomeClasses} cursor-pointer hover:opacity-90`}>
                  {declined ? '✕ Declined' : 'Invested'}
                </button>
              ) : (
                <span title={title} className={outcomeClasses}>{declined ? '✕ Declined' : 'Invested'}</span>
              )}
              {connector}
            </Fragment>
          );
        }

        const list = docs.get(step.stage) ?? [];
        const style = parked
          ? 'bg-gray-100 text-gray-400 opacity-70'
          : step.state === 'current' ? 'bg-[#0E7490] text-white'
          : step.state === 'done' ? 'bg-[#E8F4F8] text-cyan-900'
          : 'bg-gray-100 text-gray-400';

        return (
          <Fragment key={step.stage}>
            {/* §1 — o badge 📄 passa a ser filho INLINE do pill, como no
                InvestorJourneyStrip. Estava `absolute -right-1 -top-1` e
                caía por cima da seta/pill seguinte, meio escondido. O
                onClick/title/popover ficam iguais — o anchor continua a ser
                o rectângulo do próprio botão. */}
            <span title={step.at ? `${STAGE_LABEL[step.stage]} · ${step.at.slice(0, 10)}` : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${style}`}>
              {step.state === 'done' ? '✓ ' : ''}{STAGE_LABEL[step.stage]}
              {list.length > 0 && (
                <button title={hoverTitle(list)}
                  onClick={(e) => setOpenAt(openAt?.stage === step.stage
                    ? null
                    : { stage: step.stage, rect: e.currentTarget.getBoundingClientRect() })}
                  aria-label={`${list.length} document(s) shared at this stage`}
                  // Prompt 230 — o 224 deixou o emoji solto no pill, sem
                  // fundo proprio: contra o #E8F4F8 de um "done" (quase
                  // branco) ou o teal cheio de um "current", lia-se como
                  // ruido e nao como algo em que se clica. Agora tem chip
                  // proprio — branco quase opaco, sombra e anel — que
                  // contrasta com os tres estados do pill sem depender de
                  // qual deles esta por baixo.
                  className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 leading-none shadow-sm ring-1 ring-black/10 hover:bg-white">
                  📄{list.length > 1 && <span className="text-[10px] font-semibold text-gray-700">{list.length}</span>}
                </button>
              )}
            </span>
            {openAt?.stage === step.stage && list.length > 0 && (
              <DocBadgePopover
                anchor={openAt.rect}
                docs={list.map((d) => ({
                  key: `${d.interactionId}:${d.documentId}`,
                  name: docName(d.documentId), at: d.at,
                }))}
                onOpen={(key) => {
                  const d = list.find((x) => `${x.interactionId}:${x.documentId}` === key);
                  if (d) setPreview({ docId: d.documentId, at: d.at });
                }}
                onSeeInHistory={onViewInHistory && ((key) => {
                  const d = list.find((x) => `${x.interactionId}:${x.documentId}` === key);
                  if (d) onViewInHistory(d.interactionId);
                })}
                onClose={() => setOpenAt(null)} />
            )}
            {connector}
          </Fragment>
        );
      })}

      {previewDoc && preview && (
        <DocPreviewModal doc={previewDoc} sharedAt={preview.at} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
