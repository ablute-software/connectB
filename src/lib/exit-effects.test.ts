import { describe, expect, it } from 'vitest';
import { planPark, planPass, planInvested, planSnooze, advanceConfirmation, revisitTasksToClose, REVISIT_DAYS_DEFAULT } from './exit-effects';
import type { Entity, TaskItem } from './types';

// Prompt 205 — o caso real: "Test idividual", parqueada, e o Today a
// continuar a mostrar "Respond to expressed interest — OVERDUE".

const ENTITY = { id: 'e1', name: 'Test idividual' } as Entity;
const NOW = new Date('2026-08-15T10:00:00.000Z');

function task(over: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1', title: 'Follow up', entity_id: 'e1', kind: 'follow_up',
    action_type: 'other', done: false, due_at: '2026-08-01T00:00:00.000Z', ...over,
  } as TaskItem;
}

// Prompt 226 §4 — o Snooze. O que os testes fixam é a DIFERENÇA face ao
// parque: snooze é "não agora", não "desisti".
describe('planSnooze', () => {
  it('reagenda todas as pendentes para agora+N, sem fechar nenhuma', () => {
    const p = planSnooze(ENTITY, [task({ id: 'a' }), task({ id: 'b', action_type: 'follow_up_thread' })], NOW, 7);
    expect(p.dispositions).toHaveLength(2);
    expect(p.dispositions.every((d) => d.action === 'reschedule')).toBe(true);
    // O planPark fecharia a de follow_up_thread ("parquear É a resposta");
    // adiar não é responder, portanto aqui nenhuma fica feita.
    expect(p.dispositions.some((d) => d.action === 'done')).toBe(false);
    expect(p.dispositions[0]).toMatchObject({ dueAt: '2026-08-22T10:00:00.000Z' });
  });

  it('NUNCA cria task de revisita — a que já existe é que mudou de data', () => {
    expect(planSnooze(ENTITY, [task()], NOW, 3).revisitTask).toBeUndefined();
  });

  it('a confirmação diz a data de volta, não o número de dias', () => {
    expect(planSnooze(ENTITY, [task()], NOW, 30).confirmation).toContain('2026-09-14');
  });

  it('sem pendentes, não inventa disposições', () => {
    expect(planSnooze(ENTITY, [], NOW, 7).dispositions).toEqual([]);
  });

  it('só toca nas tarefas DESTA entidade', () => {
    const p = planSnooze(ENTITY, [task({ id: 'mine' }), task({ id: 'other', entity_id: 'e2' })], NOW, 7);
    expect(p.dispositions.map((d) => d.taskId)).toEqual(['mine']);
  });
});

describe('planPark', () => {
  it('agenda a revisita a 30 dias por omissao', () => {
    const p = planPark(ENTITY, [], NOW);
    expect(p.revisitTask?.dueAt.slice(0, 10)).toBe('2026-09-14');
    expect(p.revisitTask?.title).toBe('Revisit Test idividual — frozen on 2026-08-15');
    expect(REVISIT_DAYS_DEFAULT).toBe(30);
  });

  it('aceita outro prazo', () => {
    expect(planPark(ENTITY, [], NOW, 7).revisitTask?.dueAt.slice(0, 10)).toBe('2026-08-22');
  });

  // O caso do screenshot.
  it('"Respond to expressed interest" fica FEITA -- parquear foi a resposta', () => {
    const t = task({ id: 't-resp', title: 'Respond to expressed interest', action_type: 'follow_up_thread' });
    const [d] = planPark(ENTITY, [t], NOW).dispositions;
    expect(d).toEqual({ taskId: 't-resp', action: 'done', reason: 'closed — parking this investor was the answer' });
  });

  it('apanha tarefas antigas so pelo titulo, sem action_type util', () => {
    const t = task({ id: 't-old', title: 'Reply to their question', action_type: 'other' });
    expect(planPark(ENTITY, [t], NOW).dispositions[0].action).toBe('done');
  });

  it('um follow-up generico e RE-DATADO, nao fechado', () => {
    const t = task({ id: 't-fu', title: 'Follow up on the deck', action_type: 'follow_up_no_reply' });
    const [d] = planPark(ENTITY, [t], NOW).dispositions;
    expect(d.action).toBe('reschedule');
    expect(d.action === 'reschedule' && d.dueAt.slice(0, 10)).toBe('2026-09-14');
  });

  it('nao mexe em tarefas ja feitas nem noutras entidades', () => {
    const feita = task({ id: 'a', done: true });
    const outra = task({ id: 'b', entity_id: 'outra' });
    expect(planPark(ENTITY, [feita, outra], NOW).dispositions).toEqual([]);
  });

  it('a confirmacao diz a data, nao so "parqueado"', () => {
    expect(planPark(ENTITY, [], NOW).confirmation).toContain('2026-09-14');
  });
});

describe('planPass', () => {
  it('fecha TUDO, sem excepcao de tipo', () => {
    const tasks = [
      task({ id: 'a', title: 'Respond to expressed interest', action_type: 'follow_up_thread' }),
      task({ id: 'b', title: 'Follow up on the deck', action_type: 'follow_up_no_reply' }),
    ];
    const p = planPass(ENTITY, tasks);
    expect(p.dispositions.map((d) => d.action)).toEqual(['done', 'done']);
  });

  it('nao agenda revisita nenhuma -- fechado e fechado', () => {
    expect(planPass(ENTITY, [task()]).revisitTask).toBeUndefined();
  });

  it('confirma que a razao ficou registada', () => {
    expect(planPass(ENTITY, []).confirmation).toContain('reason recorded');
  });
});

// Prompt 249 §A — o irmão positivo do planPass, para "Move to Decision" ->
// "Invested".
describe('planInvested', () => {
  it('fecha TUDO, sem excepcao de tipo -- igual ao planPass', () => {
    const tasks = [
      task({ id: 'a', title: 'Respond to expressed interest', action_type: 'follow_up_thread' }),
      task({ id: 'b', title: 'Follow up on the deck', action_type: 'follow_up_no_reply' }),
    ];
    const p = planInvested(ENTITY, tasks);
    expect(p.dispositions.map((d) => d.action)).toEqual(['done', 'done']);
  });

  it('nao agenda revisita nenhuma -- fechado e fechado', () => {
    expect(planInvested(ENTITY, [task()]).revisitTask).toBeUndefined();
  });

  it('a confirmacao diz invested, nao passed', () => {
    expect(planInvested(ENTITY, []).confirmation).toContain('Invested');
  });

  it('so toca nas tarefas DESTA entidade', () => {
    const p = planInvested(ENTITY, [task({ id: 'mine' }), task({ id: 'other', entity_id: 'e2' })]);
    expect(p.dispositions.map((d) => d.taskId)).toEqual(['mine']);
  });
});

describe('advanceConfirmation', () => {
  it('nomeia o estagio de destino', () => {
    expect(advanceConfirmation('Engaged')).toBe('→ Moved to Engaged.');
  });
});

describe('revisitTasksToClose', () => {
  it('fecha a revisita quando a entidade volta a mexer', () => {
    const rev = task({ id: 't-rev', title: 'Revisit Test idividual — frozen on 2026-08-15' });
    const outra = task({ id: 't-x', title: 'Follow up' });
    expect(revisitTasksToClose([rev, outra], 'e1')).toEqual(['t-rev']);
  });

  it('ignora as ja feitas', () => {
    const rev = task({ id: 't-rev', title: 'Revisit X', done: true });
    expect(revisitTasksToClose([rev], 'e1')).toEqual([]);
  });
});
