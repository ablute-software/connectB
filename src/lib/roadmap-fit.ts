// Prompt 213 §C — o roadmap ajusta-se à largura; a lupa entra quando a
// letra ficaria ilegível.
//
// A regra, nas palavras do prompt: "ajustar à largura, nunca ao slider". O
// timeline tem colunas de largura fixa (CONTAINER_WIDTH w-60 = 240px), e a
// pergunta "cabe?" é aritmética pura — por isso vive aqui, testável, e o
// componente só desenha o que isto decide.
//
// O limiar: base 12px (text-xs, o corpo dos cartões) com piso em 11px —
// valor anunciado ao Nuno antes de escrever e confirmado. Abaixo disso não
// se comprime mais: entra o modo lupa (escolher um ano expande esse troço),
// e o scroll horizontal fica como mecanismo SECUNDÁRIO, nunca primário.
import type { RoadmapPeriodKind } from './types';

export const NATURAL_COLUMN_PX = 240; // CONTAINER_WIDTH (w-60) do RoadmapCard
export const BASE_FONT_PX = 12;       // text-xs — o corpo dos cartões
export const FLOOR_FONT_PX = 11;      // piso de legibilidade (decisão 213 §C)

export interface RoadmapFit {
  mode: 'fit' | 'lens';
  // Factor a aplicar ao contentor (zoom). Em 'fit' é o que faz caber; em
  // 'lens' é o piso — nunca menos, porque menos seria ilegível.
  scale: number;
}

// columnCount = marcos visíveis + 1 (o nó Founded ocupa a primeira coluna).
export function fitRoadmap(containerWidth: number, columnCount: number): RoadmapFit {
  if (containerWidth <= 0 || columnCount <= 0) return { mode: 'fit', scale: 1 };

  const natural = columnCount * NATURAL_COLUMN_PX;
  const scale = Math.min(1, containerWidth / natural);
  const fontAtScale = BASE_FONT_PX * scale;

  if (fontAtScale >= FLOOR_FONT_PX) return { mode: 'fit', scale };
  // Não se comprime abaixo do piso: fixa-se lá e a lupa passa a ser o
  // caminho. O que não cabe rola — secundário, não primário.
  return { mode: 'lens', scale: FLOOR_FONT_PX / BASE_FONT_PX };
}

export interface PeriodLike { period_kind: RoadmapPeriodKind; period_year: number; period_quarter?: number }

// Os troços da lupa: um por ano com marcos, ordenado. Anos e não intervalos
// arbitrários — é o corte natural de um roadmap, e um chip por ano cabe
// sempre numa linha.
export function lensYears(milestones: PeriodLike[]): number[] {
  return [...new Set(milestones.map((m) => m.period_year))].sort((a, b) => a - b);
}

export function filterToYear<T extends PeriodLike>(milestones: T[], year: number | null): T[] {
  if (year == null) return milestones;
  return milestones.filter((m) => m.period_year === year);
}
