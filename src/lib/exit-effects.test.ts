import { describe, expect, it } from 'vitest';
import { planPark, planPass, advanceConfirmation, revisitTasksToClose, REVISIT_DAYS_DEFAULT } from './exit-effects';
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

describe('planPark', () => {
  it('agenda a revisita a 30 dias por omissao', () => {
    const p = planPark(ENTITY, [], NOW);
    expect(p.revisitTask?.dueAt.slice(0, 10)).toBe('2026-09-14');
    expect(p.revisitTask?.title).toBe('Revisit Test idividual — parked on 2026-08-15');
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

describe('advanceConfirmation', () => {
  it('nomeia o estagio de destino', () => {
    expect(advanceConfirmation('Engaged')).toBe('→ Moved to Engaged.');
  });
});

describe('revisitTasksToClose', () => {
  it('fecha a revisita quando a entidade volta a mexer', () => {
    const rev = task({ id: 't-rev', title: 'Revisit Test idividual — parked on 2026-08-15' });
    const outra = task({ id: 't-x', title: 'Follow up' });
    expect(revisitTasksToClose([rev, outra], 'e1')).toEqual(['t-rev']);
  });

  it('ignora as ja feitas', () => {
    const rev = task({ id: 't-rev', title: 'Revisit X', done: true });
    expect(revisitTasksToClose([rev], 'e1')).toEqual([]);
  });
});
