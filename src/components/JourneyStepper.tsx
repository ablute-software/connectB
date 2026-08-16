'use client';
// Prompt 209 — o stepper como jornada com desfecho, na variante que o Nuno
// aprovou. Desenha o que o journeySteps() (206-C, puro e testado) decide;
// aqui não há regra de negócio nenhuma.
//
// Activo: percorrido = teal claro com ✓, actual = teal cheio, futuro = cinza.
// Fechado: só os passos dados, terminando no desfecho — sem Meeting/Diligence
// cinzentos a seguir, que era o ruído a seguir a uma relação terminada.
// Parqueado: percorrido esmaecido mas legível, chip ❄ no fim.
import { useState } from 'react';
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
    <div className="flex flex-wrap items-center gap-1 pb-1">
      {steps.map((step, idx) => {
        if (step.kind === 'parked') {
          return (
            <span key="parked" className="whitespace-nowrap rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
              ❄ Parked{step.revisitAt ? ` — revisit ${step.revisitAt.slice(0, 10)}` : ''}
            </span>
          );
        }

        if (step.kind === 'outcome') {
          const declined = step.outcome === 'declined';
          return (
            <span key="outcome"
              title={step.at ? `${declined ? 'passed' : 'invested'} ${step.at.slice(0, 10)}${step.passCategory ? ` — ${step.passCategory.replace(/_/g, ' ')}` : ''}` : undefined}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${
                declined ? 'bg-[#B00000]' : 'bg-green-700'}`}>
              {declined ? '✕ Declined' : 'Invested'}
            </span>
          );
        }

        const list = docs.get(step.stage) ?? [];
        const style = parked
          ? 'bg-gray-100 text-gray-400 opacity-70'
          : step.state === 'current' ? 'bg-[#0E7490] text-white'
          : step.state === 'done' ? 'bg-[#E8F4F8] text-cyan-900'
          : 'bg-gray-100 text-gray-400';

        return (
          <span key={step.stage} className="relative flex items-center gap-1">
            <span title={step.at ? `${STAGE_LABEL[step.stage]} · ${step.at.slice(0, 10)}` : undefined}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${style}`}>
              {step.state === 'done' ? '✓ ' : ''}{STAGE_LABEL[step.stage]}
            </span>

            {list.length > 0 && (
              <>
                <button title={hoverTitle(list)}
                  onClick={(e) => setOpenAt(openAt?.stage === step.stage
                    ? null
                    : { stage: step.stage, rect: e.currentTarget.getBoundingClientRect() })}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[#0E7490] bg-white text-[9px] leading-none">
                  {list.length > 1 ? list.length : '📄'}
                </button>
                {openAt?.stage === step.stage && (
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
              </>
            )}

            {idx < steps.length - 1 && <span className="text-gray-300">→</span>}
          </span>
        );
      })}

      {previewDoc && preview && (
        <DocPreviewModal doc={previewDoc} sharedAt={preview.at} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
