// Prompt 202 §C — o histórico de contactos é a função central da app e vivia
// atrás de um botão chamado "Open thread", que ninguém lê como "histórico".
// Estas são as partes puras do resumo inline (as últimas interações por baixo
// do RelationshipSummaryCard), separadas do JSX para poderem ser testadas —
// este projecto não tem testes de componentes.

import type { Direction, Interaction } from './types';

// A primeira linha útil do conteúdo, para a linha de uma só altura. Colapsa
// espaços e corta a meio de nada: o objectivo é reconhecer a interação, não
// lê-la. Quem quer ler abre o histórico completo.
export function firstLine(content: string | undefined, max = 90): string {
  const line = (content ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const flat = line.replace(/\s+/g, ' ');
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export const DIRECTION_LABEL: Record<Direction, string> = { out: 'Sent', in: 'Received' };

// As N mais recentes, mais recente primeiro. A ordenação por occurred_at é
// descendente aqui (ao contrário de entityInteractions, que devolve
// cronológica) porque um resumo lê-se de cima para baixo, do agora para trás.
export function recentInteractions(interactions: Interaction[], entityId: string, limit = 3): Interaction[] {
  return interactions
    .filter((i) => i.entity_id === entityId)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit);
}
