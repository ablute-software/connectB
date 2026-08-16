// Prompt 212 §B.2 — o que conta como capital em circulação NESTA ronda.
//
// O bug: pipelineStats() somava `interest_eur` de TODAS as entidades, sem
// olhar ao status. Na ablute_ isso dava €400k contra um alvo de €300k —
// €100k de uma entrada `not_contacted` (capital de uma ronda antiga, posto
// ali por não haver outro sítio) e €300k da Adara Ventures, que estava
// `dormant` DEPOIS de ter recusado. A app dizia ao modelo que a ronda estava
// mais do que fechada, com dinheiro de quem disse que não.
//
// WHITELIST e não blacklist (emenda do Nuno, 2026-08-16): um status novo
// criado no futuro fica de fora por omissão, em vez de entrar na soma por
// esquecimento. É o mesmo fail-closed do resto — o custo de esquecer é
// assimétrico, e do lado errado.
import type { Entity, EntityStatus } from './types';

// Conversa em curso. Os nomes que o Nuno usou são de ESTÁGIO
// (contacted/engaged/meeting/diligence); em `entities.status` o equivalente
// de engaged/meeting é 'in_conversation'.
//
// Deliberadamente FORA:
//   not_contacted — não houve conversa nenhuma; foi aqui que o capital
//                   antigo se disfarçou de interesse;
//   passed, dormant — recusaram ou está parado: não é capital em circulação;
//   invested — já não é "soft". É capital fechado, e é outro número; somá-lo
//              a soft-circled misturava uma promessa com um facto.
export const LIVE_STATUSES: EntityStatus[] = ['contacted', 'in_conversation', 'diligence'];

export function isLiveForCapital(status: EntityStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

// Soft-circled DESTA ronda: só de relações vivas. O nome importa tanto como
// o número — era chamar-lhe `soft_circled_eur` sem qualificar que deixava o
// modelo tratá-lo como progresso da ronda actual.
export function softCircledThisRound(entities: Pick<Entity, 'status' | 'interest_eur'>[]): number {
  return entities
    .filter((e) => isLiveForCapital(e.status))
    .reduce((sum, e) => sum + (e.interest_eur ?? 0), 0);
}

// O que ficou de fora, para a UI poder explicar em vez de o número mudar
// sem aviso: "€400k passaram a €0 e ninguém sabe porquê" é pior do que o
// bug original.
export interface ExcludedCapital { name: string; status: EntityStatus; amountEur: number }

export function capitalExcluded(
  entities: Pick<Entity, 'name' | 'status' | 'interest_eur'>[],
): ExcludedCapital[] {
  return entities
    .filter((e) => (e.interest_eur ?? 0) > 0 && !isLiveForCapital(e.status))
    .map((e) => ({ name: e.name, status: e.status, amountEur: e.interest_eur as number }));
}

// Prompt 212 §B.3 — o que sugerir ao founder sobre um `interest_eur` que
// deixou de contar. O número mudou; a app tem de dizer porquê e oferecer a
// correcção certa — e a correcção NÃO é a mesma nos dois casos reais:
//
//   "Nuno Marujo" (not_contacted, €100k) — capital de uma ronda anterior,
//   posto ali por não haver outro sítio. Vai para funding_rounds.
//
//   "Adara Ventures" (dormant, €300k) — recusaram. Não é ronda anterior
//   nenhuma: é um interesse obsoleto que ficou para trás. Só se limpa.
//
// A distinção é: houve conversa que acabou (passed/dormant) -> obsoleto;
// nunca houve conversa (not_contacted) -> provavelmente não era interesse
// de investidor nenhum, era capital sem sítio.
export type CapitalSuggestion = 'move_to_previous_funding' | 'clear_stale_interest';

export interface CapitalFix {
  entityId: string; name: string; status: EntityStatus; amountEur: number;
  suggestion: CapitalSuggestion;
}

export function suggestCapitalFixes(
  entities: Pick<Entity, 'id' | 'name' | 'status' | 'interest_eur'>[],
): CapitalFix[] {
  return entities
    .filter((e) => (e.interest_eur ?? 0) > 0 && !isLiveForCapital(e.status))
    .map((e) => ({
      entityId: e.id, name: e.name, status: e.status, amountEur: e.interest_eur as number,
      // 'invested' fica de fora das duas: não é obsoleto nem ronda passada,
      // é a ronda actual fechada. Mexer nele seria apagar um facto bom.
      suggestion: (e.status === 'passed' || e.status === 'dormant'
        ? 'clear_stale_interest' : 'move_to_previous_funding') as CapitalSuggestion,
    }))
    .filter((f) => f.status !== 'invested');
}
