'use client';
// Prompt 213 §C — o invólucro responsivo do RoadmapTimeline, para o lado do
// investidor. A regra: ajustar à largura, nunca ao slider.
//
// A decisão de escala vive em roadmap-fit.ts (pura, testada); aqui mede-se o
// contentor (ResizeObserver — a letra ajusta IMEDIATAMENTE ao redimensionar)
// e desenha-se o que ela decide.
//
// A escala aplica-se por `zoom`, não `transform: scale()`, e a escolha é
// deliberada: `zoom` participa no layout (sem compensações de largura/altura
// à mão) e — a razão que interessa ao CLAUDE.md — NÃO transforma o elemento
// em containing block de descendentes `position: fixed`. Um `transform` aqui
// seria plantar exactamente a armadilha contra a qual a regra do overlay
// avisa, à espera do primeiro popover que alguém montasse lá dentro.
// (Confirmado antes de escrever: o subtree do timeline não tem hoje nenhum
// fixed — mas a regra existe porque "hoje" muda três ficheiros mais tarde.)
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

      {/* `zoom` não é standard antigo mas é hoje universal (Firefox 126+);
          onde faltar, o pior caso é o timeline renderizar a tamanho natural
          com o scroll de sempre — degradação honesta, não quebra. */}
      <div style={fit.scale < 1 ? ({ zoom: fit.scale } as React.CSSProperties) : undefined}>
        <RoadmapTimeline foundedYear={foundedYear} milestones={visible} editable={false} categories={categories.map((c) => ({ id: c.id, label: c.label, color: c.color ?? 'gray', shape: c.shape ?? 'rounded' }))} />
      </div>
    </div>
  );
}
