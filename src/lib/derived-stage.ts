// Prompt 206-A — o stepper deixa de ser um registo manual e passa a ser uma
// vista dos factos, com o override manual visível em vez de silencioso.
//
// O diagnóstico do 206, confirmado no código: há três fontes de estado que
// nunca se falam. `relationship_state.stage` (o stepper) só muda por clique;
// `entities.status` muda por caminhos próprios e só espelha o stage enquanto
// NÃO houver linha de relationship_state — ou seja, o espelho parte-se para
// sempre à primeira vez que alguém toca no stepper; e os factos
// (`interactions` com classification) são onde a verdade vive. O screenshot
// da Adara é as três a discordarem ao mesmo tempo: stepper "Engaged", chip
// "We owe a reply", e um pass recebido dez dias antes.
//
// ---------------------------------------------------------------------------
// A regra que NÃO é óbvia, e é o centro deste ficheiro: divergência entre o
// manual e o derivado não é, por si, um erro.
//
// 'diligence' não tem facto nenhum que a produza — não há interação que
// signifique "estamos em diligência". Se qualquer diferença fosse tratada
// como suspeita, o founder que marcasse Diligence à mão veria um aviso de
// incoerência para sempre, e o aviso perdia todo o significado ao fim de dois
// dias. O founder sabe coisas que a app não sabe: um manual À FRENTE do
// derivado é normal e fica como está.
//
// O que se sinaliza é CONTRADIÇÃO: os factos dizem que isto acabou (um pass
// classificado) e o stepper continua a mostrar uma fase activa. Aí os factos
// ganham, porque é literalmente o caso Adara.
// ---------------------------------------------------------------------------
import type { Db, Interaction, RelationshipStage } from './types';
import { STAGE_ORDER, effectiveMode, type EntityMode } from './relationship';

export interface DerivedStageResult {
  // O que os factos suportam, sozinhos.
  derived: RelationshipStage;
  // O que está gravado em relationship_state, se estiver.
  manual?: RelationshipStage;
  // O que o stepper deve desenhar.
  effective: RelationshipStage;
  mode: EntityMode;
  // Manual à frente do derivado, sem contradição — normal, mas mostra-se o
  // chip "set manually" para o founder saber que aquilo não veio dos factos.
  manualAhead: boolean;
  // Os factos contradizem o manual (pass classificado vs fase activa). Aqui o
  // derivado ganha e o chip é um aviso, não uma nota.
  contradicted: boolean;
  // Respostas recebidas ainda por classificar. É um estado de primeira
  // classe, não silêncio: enquanto isto for > 0 o stepper pode estar a
  // desenhar uma fase que ninguém confirmou.
  unclassifiedReplies: number;
  // Porquê este estágio derivado, em texto curto para tooltip.
  reason: string;
}

function inboundOf(interactions: Interaction[], entityId: string): Interaction[] {
  return interactions
    .filter((i) => i.entity_id === entityId && i.direction === 'in')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function derivedStageFromFacts(db: Db, entityId: string): { stage: RelationshipStage; reason: string } {
  const mine = db.interactions.filter((i) => i.entity_id === entityId);
  if (mine.length === 0) return { stage: 'not_contacted', reason: 'no contact logged yet' };

  const inbound = inboundOf(db.interactions, entityId);
  const lastInbound = inbound.at(-1);

  // 1. Um pass classificado é terminal. Ganha a tudo o resto, inclusive a um
  //    meeting anterior: houve reunião e mesmo assim disseram que não.
  if (lastInbound?.classification === 'pass') {
    return { stage: 'decision', reason: 'their last reply is classified as a pass' };
  }

  // 2. Uma reunião registada é o facto mais forte a seguir.
  if (mine.some((i) => i.channel === 'meeting')) {
    return { stage: 'meeting', reason: 'a meeting is logged' };
  }

  // 3. Qualquer resposta recebida significa conversa a acontecer. Não se
  //    distingue por classificação aqui de propósito: 'interested' e
  //    'question' são ambos conversa, e 'awaiting' por classificar também —
  //    a app não sabe o que dizia, mas sabe que responderam.
  if (inbound.length > 0) {
    return { stage: 'engaged', reason: 'they replied' };
  }

  // 4. Só saiu daqui.
  return { stage: 'contacted', reason: 'contacted, no reply yet' };
}

export function derivedStage(db: Db, entityId: string): DerivedStageResult {
  const entity = db.entities.find((e) => e.id === entityId);
  const { stage: derived, reason } = derivedStageFromFacts(db, entityId);
  const manual = db.relationshipState.find((r) => r.entity_id === entityId)?.stage;
  // Prompt 209 (resto) — a mesma precedencia em toda a pagina: um pass
  // classificado fecha, mesmo com dormant herdado.
  const mode: EntityMode = entity ? effectiveMode(db, entityId) : 'active';

  // 'awaiting' é o único valor que pode significar "ninguém disse o que isto
  // era". Desde o 202 §A.1 também pode ser uma escolha deliberada
  // ("responderam, ainda não é decisão") — a app não consegue distinguir as
  // duas, e por isso o chip convida a classificar em vez de acusar de erro.
  const unclassifiedReplies = inboundOf(db.interactions, entityId)
    .filter((i) => !i.classification || i.classification === 'awaiting').length;

  const derivedIdx = STAGE_ORDER.indexOf(derived);
  const manualIdx = manual ? STAGE_ORDER.indexOf(manual) : -1;

  // Contradição = os factos dizem terminado e o manual mantém-no vivo.
  const contradicted = derived === 'decision' && !!manual && manual !== 'decision';
  const manualAhead = !!manual && !contradicted && manualIdx > derivedIdx;

  const effective = contradicted ? derived : (manual ?? derived);

  return { derived, manual, effective, mode, manualAhead, contradicted, unclassifiedReplies, reason };
}
