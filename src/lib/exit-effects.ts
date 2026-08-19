// Prompt 205 §A–§D/§F — as saídas do banner passam a ter consequência.
//
// O feedback ao vivo: o Nuno escolheu "Frozen" em "Test idividual" e nada
// de visível aconteceu. Pior, o Today continuou a mostrar "Respond to
// expressed interest — OVERDUE" para uma entidade que ele tinha acabado de
// parquear. A app tem de servir de conselheiro; um conselheiro que não
// regista a decisão que acabou de receber não é conselheiro nenhum.
//
// Tudo aqui é decisão pura — que tarefas mexer, para quando, e o que dizer
// ao founder. Quem executa é o componente, chamando o store. Sem schema
// novo: usa `tasks` e `due_at`, que já existem.
import type { Entity, TaskItem } from './types';

export const REVISIT_DAYS_DEFAULT = 30;

export type TaskDisposition =
  | { taskId: string; action: 'done'; reason: string }
  | { taskId: string; action: 'reschedule'; dueAt: string; reason: string };

export interface ExitPlan {
  // A task de re-contacto, quando a saída é parquear. undefined num pass:
  // fechado é fechado, não se agenda revisita para quem disse que não.
  revisitTask?: { title: string; dueAt: string };
  dispositions: TaskDisposition[];
  confirmation: string;
}

function addDays(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function pending(tasks: TaskItem[], entityId: string): TaskItem[] {
  return tasks.filter((t) => t.entity_id === entityId && !t.done);
}

// §F — por TIPO, não por tudo à bruta. Uma tarefa que pede uma RESPOSTA fica
// feita: parquear É a resposta, e mantê-la aberta seria pedir ao founder que
// respondesse outra vez ao que já decidiu. Um follow-up genérico só muda de
// data: continua a fazer sentido, mais tarde.
//
// A leitura do tipo é pelo action_type (o eixo "porque é que esta tarefa
// existe"), com o título como rede de segurança para as tarefas antigas em
// que action_type ficou 'other' — havia-as antes do campo existir.
function answersByParking(t: TaskItem): boolean {
  if (t.action_type === 'follow_up_thread') return true;
  return /respond|reply|answer/i.test(t.title);
}

export function planPark(
  entity: Pick<Entity, 'id' | 'name'>, tasks: TaskItem[], now: Date, revisitDays = REVISIT_DAYS_DEFAULT,
): ExitPlan {
  const dueAt = addDays(now, revisitDays);
  const dispositions: TaskDisposition[] = pending(tasks, entity.id).map((t) => (
    answersByParking(t)
      ? { taskId: t.id, action: 'done' as const, reason: 'closed — parking this investor was the answer' }
      : { taskId: t.id, action: 'reschedule' as const, dueAt, reason: 'parked until the revisit date' }
  ));

  return {
    revisitTask: { title: `Revisit ${entity.name} — frozen on ${now.toISOString().slice(0, 10)}`, dueAt },
    dispositions,
    confirmation: `❄ Frozen — revisit task created for ${dueAt.slice(0, 10)}.`,
  };
}

// Prompt 226 §4 — o irmão do planPark, para o Snooze. A diferença é o que
// NÃO faz: não parqueia a entidade (o status fica como está — snooze é "não
// agora", não "desisti") e não cria task de revisita, porque a task que já
// existe é que muda de data. Também não fecha nenhuma: um follow-up adiado
// continua a ser um follow-up, e marcá-lo feito seria mentir sobre trabalho
// que não foi feito.
//
// Extraído em vez de duplicado, como o prompt pede: a parte comum é o
// pending() + addDays(), e o que difere é a disposição.
export function planSnooze(
  entity: Pick<Entity, 'id' | 'name'>, tasks: TaskItem[], now: Date, days: number,
): ExitPlan {
  const dueAt = addDays(now, days);
  return {
    dispositions: pending(tasks, entity.id).map((t) => ({
      taskId: t.id, action: 'reschedule' as const, dueAt, reason: `snoozed for ${days} day${days === 1 ? '' : 's'}`,
    })),
    confirmation: `⏳ Snoozed — back on your list ${dueAt.slice(0, 10)}.`,
  };
}

export function planPass(entity: Pick<Entity, 'id' | 'name'>, tasks: TaskItem[]): ExitPlan {
  // §C — no pass é sempre done, sem excepção de tipo. A agenda não pode
  // continuar a mandar fazer follow-up a quem disse que não.
  return {
    dispositions: pending(tasks, entity.id).map((t) => ({
      taskId: t.id, action: 'done' as const, reason: 'closed — passed',
    })),
    confirmation: '✕ Passed — reason recorded. This relationship is closed.',
  };
}

// Prompt 249 §A — o irmão positivo do planPass, para o novo "Move to
// Decision" com confirmação: um desfecho fecha o loop de tarefas pendentes
// tal como o outro, seja qual for a direcção. Sem razão obrigatória (só o
// pass a pede — "porque disseram que não" é o que melhora o pitch; um
// investimento não precisa de justificação).
export function planInvested(entity: Pick<Entity, 'id' | 'name'>, tasks: TaskItem[]): ExitPlan {
  return {
    dispositions: pending(tasks, entity.id).map((t) => ({
      taskId: t.id, action: 'done' as const, reason: 'closed — invested',
    })),
    confirmation: '✓ Invested — this relationship is closed.',
  };
}

// §A — a terceira saída (avançar) não mexe em tarefas, mas confirma na
// mesma: o founder tem de ver que o clique fez alguma coisa.
export function advanceConfirmation(stageLabel: string): string {
  return `→ Moved to ${stageLabel}.`;
}

// O critério partilhado de "isto é uma task de revisita" — usado aqui e no
// Actions required (216 §C): uma função, nunca duas regexes que divergem.
export function isRevisitTitle(title: string): boolean {
  return /^Revisit /.test(title);
}

// §B, reversão — reactivar uma entidade parqueada fecha a task de revisit,
// que deixou de ter sentido. Devolve os ids a marcar como feitos.
export function revisitTasksToClose(tasks: TaskItem[], entityId: string): string[] {
  return pending(tasks, entityId).filter((t) => isRevisitTitle(t.title)).map((t) => t.id);
}
