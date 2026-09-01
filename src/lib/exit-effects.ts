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

// Prompt 527 — the history note a dismissal leaves behind.
//
// Until now, every "park this investor" path wrote straight to
// entities.dormant_since/dormant_reason and logged NOTHING: journey.ts:108-116
// says so in as many words, as a known gap left on purpose. So the founder
// could dismiss Sherlock's advice and, a month later, find no record that a
// decision had ever been made — only an investor that had quietly gone quiet.
//
// Pure on purpose: the wording is the part worth testing, and it must never
// invent provenance a row does not have. A task that was never a Sherlock
// suggestion says so by omission — it names the task, not an advisor.
export type DismissSource =
  | { kind: 'suggestion'; text: string; personName?: string | null }
  | { kind: 'task'; title: string; fromSherlock: boolean }
  | { kind: 'reawakening'; text?: string | null }
  // The dossier's own exit menu: the founder parked deliberately, from the
  // investor's page, with no Sherlock suggestion on screen to dismiss.
  // Writing "Dismissed — Sherlock suggested…" there would invent an advisor
  // that never spoke.
  | { kind: 'manual'; label: string };

function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function dismissNoteContent(source: DismissSource, now: Date): string {
  const day = isoDay(now);
  if (source.kind === 'reawakening') {
    // The entity is ALREADY dormant here — the founder is declining to wake
    // it, not parking it. "Stayed dormant" rather than "Marked dormant", so
    // the history does not read as a second, invented state change.
    const detail = source.text?.trim();
    return detail
      ? `Dismissed — Sherlock suggested reawakening this investor (${detail}). Stayed dormant on ${day}.`
      : `Dismissed — Sherlock suggested reawakening this investor. Stayed dormant on ${day}.`;
  }
  if (source.kind === 'task') {
    // task.source tells us whether Sherlock proposed this or the founder
    // wrote it themselves. Claiming "Sherlock suggested" for a hand-written
    // task would be a fabricated provenance in a permanent record.
    const lead = source.fromSherlock
      ? `Dismissed — Sherlock suggested: "${source.title.trim()}"`
      : `Dismissed the follow-up "${source.title.trim()}"`;
    return `${lead}. Marked dormant on ${day}.`;
  }
  if (source.kind === 'manual') {
    return `Parked by choice — ${source.label.trim()}. Marked dormant on ${day}.`;
  }
  const who = source.personName?.trim() ? ` for ${source.personName.trim()}` : '';
  const quoted = `Dismissed — Sherlock suggested: "${source.text.trim()}"${who}`;
  // The suggestion is quoted verbatim, so it often already ends in its own
  // full stop — `"Follow up.".` reads like a typo. A person clause always
  // needs the stop (a name never carries one), a bare quote that already
  // ends in terminal punctuation does not.
  const needsStop = !!who || !/[.!?]"$/.test(quoted);
  return `${quoted}${needsStop ? '.' : ''} Marked dormant on ${day}.`;
}

// The reason stamped on entities.dormant_reason when a dismissal parks an
// investor. dormant_reason is free text with no enum (seed.ts:188, and the
// propose_dormant automation both write prose), so nothing to migrate.
export function dismissDormantReason(now: Date): string {
  return `Dismissed Sherlock's suggestion on ${isoDay(now)}.`;
}
