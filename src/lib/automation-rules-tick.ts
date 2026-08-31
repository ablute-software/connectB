// Prompt 498 — o motor de regras (`rules.ts`) do lado do servidor: a metade
// PURA. Decide o que o sweep diário deve criar; não fala com a base de dados
// (isso é automation-rules-tick-server.ts). Mesmo corte que
// catalog-monthly-delivery.ts / -server.ts, e pela mesma razão: as decisões
// que interessam ficam testáveis sem Supabase.
//
// `rules.ts` NÃO é tocado (CLAUDE.md: "keep rules.ts untouched — feed it live
// data instead of seed data"). Este ficheiro só o alimenta e filtra o que ele
// devolve.
import type { ActionType, Db, TaskItem, TaskKind } from './types';
import { LOCK_DAYS, buildFollowUpTask, outboundsAwaitingFollowUp, passReasonAlert } from './rules';

// O tecto de obsolescência. `outboundsAwaitingFollowUp` é puro e genérico:
// diz "este thread está em silêncio há mais de LOCK_DAYS", sem opinião sobre
// há QUANTO mais. Numa base seed isso nunca importou; em produção importa
// muito — medido antes de escrever isto (31/08/2026, org ablute_): das 72
// entidades que a função devolve, 51 têm o último outbound há mais de um ano
// e a média de silêncio é de ~2113 dias (histórico importado, o mais antigo
// de 2018). Criar 72 tarefas de "faz follow-up" a uma mensagem de 2018 seria
// exactamente a parede de trabalho que a regra de ouro do Sherlock proíbe, e
// pior: seria conselho errado. Passados 90 dias o movimento certo já não é um
// follow-up, é a doutrina de reabertura que o codebase já tem — e 90 é o
// mesmo limiar que reopen-signals.ts (LOW_CONFIDENCE_NUDGE_DAYS) usa para
// essa fronteira, não um número inventado aqui.
export const FOLLOW_UP_STALE_AFTER_DAYS = 90;

// Estados terminais: um follow-up a quem já passou, já investiu ou já está
// dormente contradiz as próprias regras de outreach (e a doutrina de
// reabertura, que tem o seu caminho próprio). 26 das 72 pendentes de hoje
// caem aqui.
const TERMINAL_STATUSES = new Set(['passed', 'invested', 'dormant']);

export type AutomationTaskSource = 'automation_follow_up' | 'automation_dormant';

export interface PlannedTask {
  source: AutomationTaskSource;
  kind: TaskKind;
  action_type: ActionType;
  title: string;
  due_at: string;
  entity_id: string;
  person_id?: string;
}

// Só o que `outboundsAwaitingFollowUp` e `passReasonAlert` lêem de facto —
// nem uma coluna a mais é carregada do servidor por causa disso.
export type RulesDbSlice = Pick<Db, 'interactions' | 'people' | 'entities'>;

export type OpenTaskSlice = Pick<TaskItem, 'entity_id' | 'kind' | 'source'>;

export interface AutomationRulesTickInput {
  db: RulesDbSlice;
  /** Tarefas com done = false da org. Base do guarda de idempotência. */
  openTasks: OpenTaskSlice[];
  followUpEnabled: boolean;
  dormantEnabled: boolean;
  /** Tecto de tarefas novas por corrida — ver `maxPerTick` no plan(). */
  maxPerTick: number;
  now: Date;
}

export interface AutomationRulesTickPlan {
  tasks: PlannedTask[];
  /** Quantas pendências `rules.ts` devolveu antes de qualquer filtro. */
  considered: number;
  skipped: { stale: number; terminalStatus: number; doNotContact: number; alreadyOpen: number; disabled: number; overCap: number };
  /** `passReasonAlert` avaliado sobre os mesmos dados. Ver o comentário em -server.ts. */
  passPattern: { category: string; count: number } | null;
}

export function planAutomationRulesTick(input: AutomationRulesTickInput): AutomationRulesTickPlan {
  const { db, openTasks, followUpEnabled, dormantEnabled, maxPerTick, now } = input;
  // `outboundsAwaitingFollowUp`/`passReasonAlert` só tocam nestes três arrays
  // (interactions, people, entities) — verificado em rules.ts, e o teste
  // deste ficheiro passa exactamente esta forma. O cast é o preço de não
  // alargar a assinatura de rules.ts, que é o que CLAUDE.md manda não fazer.
  const asDb = db as unknown as Db;
  const pending = outboundsAwaitingFollowUp(asDb, now);
  const skipped = { stale: 0, terminalStatus: 0, doNotContact: 0, alreadyOpen: 0, disabled: 0, overCap: 0 };

  const staleCutoff = now.getTime() - FOLLOW_UP_STALE_AFTER_DAYS * 86_400_000;
  const hasOpenFollowUp = new Set(openTasks.filter((t) => t.kind === 'follow_up' && t.entity_id).map((t) => t.entity_id!));
  const hasOpenDormant = new Set(openTasks.filter((t) => t.source === 'automation_dormant' && t.entity_id).map((t) => t.entity_id!));

  const candidates: PlannedTask[] = [];
  // Mais recente primeiro: se o tecto morder, o que sobrevive é o thread com
  // mais hipóteses de ainda estar vivo, não o mais antigo por acaso da ordem.
  const ordered = [...pending].sort((a, b) => b.interaction.occurred_at.localeCompare(a.interaction.occurred_at));

  for (const p of ordered) {
    const entity = p.entity;
    if (!entity) continue;

    if (new Date(p.interaction.occurred_at).getTime() < staleCutoff) { skipped.stale++; continue; }
    if (TERMINAL_STATUSES.has(entity.status)) { skipped.terminalStatus++; continue; }

    if (p.isSecondSilence) {
      // Segundo silêncio: nunca uma terceira mensagem (rules.ts §8). O que
      // se propõe é a DECISÃO de marcar dormente, não outro contacto.
      if (!dormantEnabled) { skipped.disabled++; continue; }
      if (hasOpenDormant.has(entity.id)) { skipped.alreadyOpen++; continue; }
      candidates.push({
        source: 'automation_dormant', kind: 'admin', action_type: 'other',
        title: `Decide: mark ${entity.name} dormant — no reply after the follow-up`,
        due_at: dueAt(p.interaction.occurred_at),
        entity_id: entity.id, person_id: p.person?.id,
      });
      hasOpenDormant.add(entity.id);
      continue;
    }

    if (!followUpEnabled) { skipped.disabled++; continue; }
    if (p.person?.do_not_contact) { skipped.doNotContact++; continue; }
    // Guarda largo de propósito: QUALQUER tarefa de follow-up aberta para
    // esta entidade chega para não criar outra — a do sweep de ontem, a que
    // logInteraction já cria em cada outbound (buildFollowUpTask, o mesmo
    // helper usado aqui), ou uma que o founder escreveu à mão. Duas tarefas
    // abertas a dizer o mesmo sobre a mesma entidade são ruído,
    // independentemente de quem as criou.
    if (hasOpenFollowUp.has(entity.id)) { skipped.alreadyOpen++; continue; }
    const base = buildFollowUpTask(
      entity.id, p.person?.id, entity.name, p.person?.full_name, p.interaction.occurred_at,
    );
    candidates.push({
      source: 'automation_follow_up', kind: base.kind, action_type: base.action_type,
      title: base.title, due_at: base.due_at!, entity_id: entity.id, person_id: p.person?.id,
    });
    hasOpenFollowUp.add(entity.id);
  }

  // Tecto por corrida. O que fica de fora não se perde: o sweep é sem estado
  // e volta a derivar tudo amanhã. Ver -server.ts para de onde vem o número.
  const tasks = candidates.slice(0, Math.max(0, maxPerTick));
  skipped.overCap = candidates.length - tasks.length;

  return { tasks, considered: pending.length, skipped, passPattern: passReasonAlert(asDb) };
}

function dueAt(occurredAt: string): string {
  // O mesmo prazo que buildFollowUpTask aplica ao ramo de follow-up
  // (occurredAt + LOCK_DAYS), para os dois ramos falarem do mesmo relógio.
  // Para um silêncio antigo isto cai no passado, e é isso que se quer dizer:
  // a decisão está atrasada desde essa data, não a partir de hoje.
  return new Date(new Date(occurredAt).getTime() + LOCK_DAYS * 86_400_000).toISOString();
}
