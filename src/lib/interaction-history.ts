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

// Prompt 202 §F — que documento foi partilhado nesta interação, e em que
// VERSÃO na altura. Interaction.document_id já existia (o dropdown "Material
// shared" do log) e documentVersions também (E7), mas nada no histórico os
// mostrava — a pergunta "que deck é que eles viram?" não tinha resposta no
// ecrã mesmo estando tudo gravado.
//
// A precisão aqui é honesta ou não é nada: se a versão da altura não for
// determinável, dizemos isso em vez de mostrar a actual como se fosse a que
// eles viram. É a diferença entre um histórico e uma reconstituição.
export type SharedDocResolution =
  | { kind: 'none' }
  | { kind: 'unversioned' }                                    // documento sem versões registadas
  | { kind: 'at_time'; version: number }                       // sabemos qual era à data
  | { kind: 'current_only'; version: number };                 // só sabemos a actual — dizê-lo

export interface VersionLike { document_id: string; version: number; uploaded_at: string }

export function resolveSharedVersion(
  versions: VersionLike[], documentId: string | undefined, occurredAt: string,
): SharedDocResolution {
  if (!documentId) return { kind: 'none' };
  const mine = versions.filter((v) => v.document_id === documentId)
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  if (mine.length === 0) return { kind: 'unversioned' };

  // A versão em vigor à data é a última carregada ATÉ a interação acontecer.
  const atTime = mine.filter((v) => v.uploaded_at <= occurredAt).at(-1);
  if (atTime) return { kind: 'at_time', version: atTime.version };

  // Todas as versões são posteriores à interação: o ficheiro que eles viram
  // não ficou registado. Não inventamos — devolvemos a mais antiga conhecida
  // marcada como "não é a da altura".
  return { kind: 'current_only', version: mine[0].version };
}

// Prompt 202 §D — o valor pedido, curto o suficiente para caber numa linha
// de histórico. Null/undefined NÃO é zero: devolve undefined para o ecrã
// simplesmente não mostrar nada, em vez de afirmar "€0".
export function formatAsk(amountEur: number | undefined | null): string | undefined {
  if (amountEur == null || !Number.isFinite(amountEur)) return undefined;
  if (amountEur >= 1_000_000) {
    const m = amountEur / 1_000_000;
    return `€${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (amountEur >= 1_000) return `€${Math.round(amountEur / 1_000)}k`;
  return `€${amountEur}`;
}
