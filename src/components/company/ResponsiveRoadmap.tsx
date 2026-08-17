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

export function ResponsiveRoadmap<T extends PeriodLike & { items: string[] }>({
  foundedYear, milestones,
}: {
  foundedYear: number | null;
  milestones: T[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // null = vista completa. A lupa é estado local: escolher um ano é uma
  // leitura, não uma preferência a persistir.
  const [lensYear, setLensYear] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = filterToYear(milestones, lensYear);
  // +1: o nó Founded ocupa a primeira coluna do timeline.
  const fit = width > 0 ? fitRoadmap(width, visible.length + 1) : { mode: 'fit' as const, scale: 1 };
  const years = lensYears(milestones);
  // Os chips só aparecem quando servem para alguma coisa: ou porque a vista
  // completa não cabe (lens), ou porque já se está dentro de um troço.
  const showChips = (fit.mode === 'lens' || lensYear != null) && years.length > 1;

  return (
    <div ref={ref}>
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
        <RoadmapTimeline foundedYear={foundedYear} milestones={visible} editable={false} />
      </div>
    </div>
  );
}
