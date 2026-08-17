// Prompt 213 §D — categorias de eventos do roadmap: o vocabulário partilhado
// entre o editor do founder e o filtro do investidor.
//
// Espelho TypeScript dos check constraints da 0177: paleta e formas são
// conjuntos FECHADOS para não degenerar — cor livre acabava em roadmaps
// arco-íris ilegíveis e formas livres acabavam em CSS por marco. O founder
// escolhe de um conjunto que se mantém legível; a liberdade fica no LABEL,
// que é onde ela vale alguma coisa.
import type { RoadmapItemV2 } from './types';

export const CATEGORY_COLORS = ['teal', 'blue', 'amber', 'red', 'green', 'purple', 'pink', 'gray'] as const;
export type CategoryColor = typeof CATEGORY_COLORS[number];

export const CATEGORY_SHAPES = ['rounded', 'square', 'pill', 'diamond'] as const;
export type CategoryShape = typeof CATEGORY_SHAPES[number];

// Tokens -> classes. Num só sítio, para o editor e o dossier desenharem a
// mesma cor a partir do mesmo token — duas tabelas destas divergiam à
// primeira cor acrescentada.
export const COLOR_STYLES: Record<CategoryColor, { chip: string; dot: string }> = {
  teal: { chip: 'bg-cyan-50 text-cyan-900 border-cyan-200', dot: 'bg-[#0E7490]' },
  blue: { chip: 'bg-blue-50 text-blue-900 border-blue-200', dot: 'bg-blue-600' },
  amber: { chip: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-500' },
  red: { chip: 'bg-red-50 text-red-900 border-red-200', dot: 'bg-[#B00000]' },
  green: { chip: 'bg-green-50 text-green-900 border-green-200', dot: 'bg-green-600' },
  purple: { chip: 'bg-purple-50 text-purple-900 border-purple-200', dot: 'bg-purple-600' },
  pink: { chip: 'bg-pink-50 text-pink-900 border-pink-200', dot: 'bg-pink-600' },
  gray: { chip: 'bg-gray-50 text-gray-700 border-gray-200', dot: 'bg-gray-500' },
};

export const SHAPE_STYLES: Record<CategoryShape, string> = {
  rounded: 'rounded-lg',
  square: 'rounded-none',
  pill: 'rounded-full',
  diamond: 'rounded-lg rotate-45',
};

// "General" não é uma categoria gravada — é a ausência de uma. Existe só no
// leitor, e é por isso que apagar uma categoria nunca parte nada: um
// category_id que não resolve lê-se como General.
export const GENERAL_LABEL = 'General';

// ---------------------------------------------------------------------------
// Leitura retrocompatível: items_v2 quando existe, senão o items text[]
// antigo como General. É a conversão lazy da 0177 do lado de quem lê.
export function readItems(m: { items: string[]; items_v2?: RoadmapItemV2[] | null }): RoadmapItemV2[] {
  if (m.items_v2 && m.items_v2.length > 0) return m.items_v2;
  return m.items.map((text) => ({ text, category_id: null }));
}

export interface CategoryLike { id: string; label: string }

// O rótulo de um item, com o lookup-miss a cair em General — o contrato que
// torna a remoção de categorias segura sem triggers.
export function itemCategoryLabel(item: RoadmapItemV2, categories: CategoryLike[]): string {
  if (!item.category_id) return GENERAL_LABEL;
  return categories.find((c) => c.id === item.category_id)?.label ?? GENERAL_LABEL;
}

// ---------------------------------------------------------------------------
// O filtro do investidor: que itens ficam visíveis com este conjunto de
// categorias ligadas. `enabled` é por LABEL resolvido (não por id) para
// General — que não tem id — ser filtrável como as outras.
export function filterItemsByCategories(
  items: RoadmapItemV2[], categories: CategoryLike[], enabled: Set<string>,
): RoadmapItemV2[] {
  return items.filter((i) => enabled.has(itemCategoryLabel(i, categories)));
}

// A legenda = a própria lista de checkboxes: as categorias da startup que
// TÊM itens, mais General se houver itens sem categoria. Não se listam
// categorias vazias — um checkbox que não muda nada é ruído.
export function legendLabels(
  milestones: { items: string[]; items_v2?: RoadmapItemV2[] | null }[],
  categories: CategoryLike[],
): string[] {
  const used = new Set<string>();
  for (const m of milestones) {
    for (const i of readItems(m)) used.add(itemCategoryLabel(i, categories));
  }
  // Ordem: as categorias pela ordem do founder, General no fim.
  const ordered = categories.map((c) => c.label).filter((l) => used.has(l));
  if (used.has(GENERAL_LABEL) && !ordered.includes(GENERAL_LABEL)) ordered.push(GENERAL_LABEL);
  return ordered;
}

// (3/3) — o filtro ao nível do MARCO, para o timeline do investidor. Um
// marco cujos itens ficaram todos filtrados desaparece por inteiro: uma
// coluna vazia não é informação, é um buraco — e ao desaparecer, o
// fitRoadmap (213 §C) ganha largura de volta, portanto filtrar também
// des-zooma. Os dois §§ compõem sozinhos.
export function filterMilestonesByCategories<T extends { items: string[]; items_v2?: RoadmapItemV2[] | null }>(
  milestones: T[], categories: CategoryLike[], enabled: Set<string>,
): (T & { items_v2: RoadmapItemV2[] })[] {
  return milestones
    .map((m) => ({ ...m, items_v2: filterItemsByCategories(readItems(m), categories, enabled) }))
    .filter((m) => m.items_v2.length > 0);
}
