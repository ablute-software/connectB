'use client';
// Prompt 213 §C — o invólucro responsivo do RoadmapTimeline, para o lado do
// investidor. A regra: ajustar à largura, nunca ao slider.
//
// Prompt 352 §C — o `zoom` que este ficheiro aplicava (ver git history para
// o comentário original) foi REMOVIDO: fitRoadmap assumia que todos os
// marcos tinham de caber numa única linha (natural = columnCount *
// NATURAL_COLUMN_PX, columnCount = total de marcos), cálculo que ficou
// desactualizado quando o Prompt 327 deu ao próprio RoadmapTimeline a
// capacidade de se dividir em várias linhas (useColumnsPerRow, com piso de 2
// colunas) — a mesma lógica que já corre, sem qualquer zoom, no lado do
// founder (RoadmapCard.tsx chama RoadmapTimeline directamente). Com muitos
// marcos e uma coluna estreita (o caso do modo Track & Evaluate, 260-300px),
// esse cálculo entrava em modo "lens" e aplicava um zoom que, medido DENTRO
// de um contentor já zoomado, é exactamente o tipo de interacção
// ResizeObserver+zoom que produz medições inconsistentes — o candidato mais
// provável para os cartões cortados/afunilados reportados. Sem o zoom, o
// investidor vê o MESMO mecanismo de fit (largura real da coluna,
// quebra-em-linhas, nunca scroll horizontal) que o founder já usa —
// `fitRoadmap` continua a decidir apenas SE os chips de "lupa por ano" valem
// a pena mostrar, nunca mais uma escala aplicada ao DOM.
import { useEffect, useRef, useState } from 'react';
import { RoadmapTimeline } from '@/components/company/RoadmapCard';
import { fitRoadmap, lensYears, filterToYear, type PeriodLike } from '@/lib/roadmap-fit';
import { legendLabels, filterMilestonesByCategories, COLOR_STYLES, SHAPE_STYLES, type CategoryLike, type CategoryColor, type CategoryShape } from '@/lib/roadmap-categories';
import type { RoadmapItemV2 } from '@/lib/types';

export function ResponsiveRoadmap<T extends PeriodLike & { items: string[]; items_v2?: RoadmapItemV2[] | null }>({
  foundedYear, milestones, categories = [],
}: {
  foundedYear: number | null;
  milestones: T[];
  // Prompt 213 §D (3/3) — as categorias da startup, para a legenda de
  // checkboxes. As cores/formas que o investidor ve sao as que o founder
  // definiu; a legenda E a lista de checkboxes.
  categories?: (CategoryLike & { color?: string; shape?: string })[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // null = vista completa. A lupa é estado local: escolher um ano é uma
  // leitura, não uma preferência a persistir.
  const [lensYear, setLensYear] = useState<number | null>(null);
  // null = todas ligadas (o default do §D). So vira Set quando o investidor
  // mexe — assim categorias novas que cheguem entretanto nascem LIGADAS,
  // em vez de ficarem de fora por nao estarem num Set gravado antes.
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const legend = legendLabels(milestones, categories);
  const enabled = new Set(legend.filter((l) => !disabled.has(l)));
  // Categoria primeiro, lupa depois: um marco que fique vazio pelo filtro
  // desaparece e devolve largura ao fitRoadmap — filtrar tambem des-zooma.
  const byCategory = legend.length > 1 ? filterMilestonesByCategories(milestones, categories, enabled) : milestones;
  const visible = filterToYear(byCategory, lensYear);
  // +1: o nó Founded ocupa a primeira coluna do timeline.
  const fit = width > 0 ? fitRoadmap(width, visible.length + 1) : { mode: 'fit' as const, scale: 1 };
  const years = lensYears(milestones);
  // Os chips só aparecem quando servem para alguma coisa: ou porque a vista
  // completa não cabe (lens), ou porque já se está dentro de um troço.
  const showChips = (fit.mode === 'lens' || lensYear != null) && years.length > 1;

  return (
    <div ref={ref}>
      {legend.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {legend.map((label) => {
            const cat = categories.find((c) => c.label === label);
            const dot = cat?.color ? (COLOR_STYLES[cat.color as CategoryColor]?.dot ?? 'bg-gray-400') : 'bg-gray-400';
            const shape = cat?.shape ? (SHAPE_STYLES[cat.shape as CategoryShape] ?? 'rounded-full') : 'rounded-full';
            return (
              <label key={label} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
                <input type="checkbox" checked={!disabled.has(label)}
                  onChange={() => setDisabled((prev) => {
                    const next = new Set(prev);
                    if (next.has(label)) next.delete(label); else next.add(label);
                    return next;
                  })}
                  className="h-3 w-3 accent-[#0E7490]" />
                <span aria-hidden className={`h-2.5 w-2.5 ${shape} ${dot}`} />
                {label}
              </label>
            );
          })}
        </div>
      )}
      {showChips && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {lensYear != null && (
            <button onClick={() => setLensYear(null)}
              className="font-medium text-[#0E7490] hover:underline">
              ← All periods
            </button>
          )}
          {years.map((y) => (
            <button key={y} onClick={() => setLensYear(y === lensYear ? null : y)}
              className={`rounded-full px-2.5 py-0.5 font-medium ${
                y === lensYear ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Prompt 352 §C — RoadmapTimeline directly, no zoom wrapper: it
          measures and wraps into rows on its own (Prompt 327), the same
          mechanism the founder-side RoadmapCard.tsx already relies on with
          no wrapper at all. This occupies the real width of whatever column
          it's placed in, exactly like the founder's own view. */}
      <RoadmapTimeline foundedYear={foundedYear} milestones={visible} editable={false} categories={categories.map((c) => ({ id: c.id, label: c.label, color: c.color ?? 'gray', shape: c.shape ?? 'rounded' }))} />
    </div>
  );
}
