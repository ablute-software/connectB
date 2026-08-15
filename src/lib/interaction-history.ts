// Prompt 202 §C — o histórico de contactos é a função central da app e vivia
// atrás de um botão chamado "Open thread", que ninguém lê como "histórico".
// Estas são as partes puras do resumo inline (as últimas interações por baixo
// do RelationshipSummaryCard), separadas do JSX para poderem ser testadas —
// este projecto não tem testes de componentes.

import type { Direction, Interaction } from './types';

// Prompt 208 §A — a linha de resumo tem de saltar a saudação.
//
// Caso real: a linha da Adara mostrava "Dear Nuno," — zero informação, quando
// o essencial estava na frase seguinte ("...we have decided not to pursue a
// potential investment..."). Heurística, sem AI: resolve a maioria de graça,
// e um resumo por AI por interação é a evolução natural disto, não algo que
// esta função tenha de fingir fazer.
//
// Três regras, por ordem:
//   1. saltar saudações e linhas curtas de mais para dizerem alguma coisa;
//   2. dentro da primeira linha substantiva, preferir a FRASE que carrega
//      sinal de decisão, se existir;
//   3. a saudação é fallback, nunca resultado: um email que SÓ tenha "Dear
//      Nuno," mostra isso mesmo, em vez de mostrar vazio.
const GREETING = /^(dear|hi|hello|olá|ola|caro|cara|bom dia|boa tarde|exmo)\b/i;

// Os termos que costumam carregar o desfecho. Não é análise de linguagem: é
// uma lista curta e explícita, e quando nenhum bate o comportamento é o
// anterior (primeira frase substantiva).
const DECISION_SIGNAL = /(not to pursue|decided|unfortunately|not a fit|no fit|interested|next step|meeting|\bpass\b|\bdecline)/i;

function usefulLength(line: string): number {
  return line.replace(/[^\p{L}\p{N}]/gu, '').length;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

// Janela centrada no termo que interessa. Truncar sempre pelo fim perdia
// exactamente o sinal quando ele está no fim da frase — que é o caso da
// Adara ("...we have decided not to pursue a potential investment.").
function windowAround(text: string, at: number, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  let start = Math.max(0, at - half);
  if (start + max > text.length) start = Math.max(0, text.length - max);
  const prefix = start > 0 ? '…' : '';
  const end = Math.min(text.length, start + max - prefix.length - 1);
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export function firstLine(content: string | undefined, max = 90): string {
  const lines = (content ?? '').split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);
  if (lines.length === 0) return '';

  const substantive = lines.find((l) => !GREETING.test(l) && usefulLength(l) >= 15);
  const source = substantive ?? lines[0];   // regra 3: saudação é fallback

  const sentences = splitSentences(source);
  const signal = sentences.find((sen) => DECISION_SIGNAL.test(sen));
  if (signal) {
    const m = signal.match(DECISION_SIGNAL);
    return windowAround(signal, m?.index ?? 0, max);
  }

  return source.length <= max ? source : `${source.slice(0, max - 1).trimEnd()}…`;
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

// Prompt 208 §D — quais das respostas recebidas estao por classificar, da
// mais antiga para a mais recente. Mais antiga primeiro de proposito: e a
// que esta ha mais tempo a enganar o resto da app (o caso Adara ficou dez
// dias a mostrar "Engaged" por causa disto).
//
// Mesmo criterio do derivedStage: 'awaiting' ou sem classificacao nenhuma.
// Nao inclui outbound -- um outbound nao tem nada para classificar.
export function unclassifiedInbound(interactions: Interaction[], entityId: string): Interaction[] {
  return interactions
    .filter((i) => i.entity_id === entityId && i.direction === 'in'
      && (!i.classification || i.classification === 'awaiting'))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}
