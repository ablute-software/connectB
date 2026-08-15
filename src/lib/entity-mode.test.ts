import { describe, expect, it } from 'vitest';
import { entityMode, nextBestAction, nextPendingTaskDue } from './relationship';
import type { Db, Entity, TaskItem } from './types';

// Prompt 205 §E — o caso confirmado por screenshot em "Test idividual":
// depois de escolher Frozen, o pill dizia "dormant" e a mesma página dizia
// "We owe a reply" e "Ready for first contact — run pre-flight". O conselho
// é a parte que o founder lê, portanto é a que tem de calar-se primeiro.

const NOW = new Date('2026-08-15T10:00:00.000Z');

function entity(over: Partial<Entity> = {}): Entity {
  return { id: 'e1', name: 'Test idividual', type: 'vc', status: 'contacted', ...over } as Entity;
}

function task(over: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1', title: 'Respond to expressed interest', entity_id: 'e1',
    kind: 'follow_up', action_type: 'other', done: false, ...over,
  } as TaskItem;
}

function db(e: Entity, tasks: TaskItem[] = []): Db {
  return { entities: [e], interactions: [], people: [], tasks, relationshipState: [] } as unknown as Db;
}

describe('entityMode', () => {
  it('dormant e parked', () => expect(entityMode({ status: 'dormant' } as Entity)).toBe('parked'));
  it('passed e closed', () => expect(entityMode({ status: 'passed' } as Entity)).toBe('closed'));
  it('invested e closed', () => expect(entityMode({ status: 'invested' } as Entity)).toBe('closed'));
  it('o resto e active', () => {
    expect(entityMode({ status: 'contacted' } as Entity)).toBe('active');
    expect(entityMode({ status: 'not_contacted' } as Entity)).toBe('active');
  });
});

describe('nextBestAction — parqueado nao pode gritar "ready for first contact"', () => {
  it('dormant sem tarefa: diz que esta parqueado, e mais nada', () => {
    const e = entity({ status: 'dormant' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Parked — no revisit scheduled.');
  });

  it('dormant com revisit agendado: diz quando volta', () => {
    const e = entity({ status: 'dormant' });
    const t = task({ id: 't-rev', title: 'Revisit Test idividual', due_at: '2026-09-14T00:00:00.000Z' });
    expect(nextBestAction(db(e, [t]), 'e1', NOW)).toBe('Parked — revisit on 2026-09-14.');
  });

  it('o conselho antigo ("Ready for first contact") desaparece de todo', () => {
    const e = entity({ status: 'dormant' });
    expect(nextBestAction(db(e), 'e1', NOW)).not.toContain('pre-flight');
    expect(nextBestAction(db(e), 'e1', NOW)).not.toContain('first contact');
  });

  it('passed le-se fechado, com a porta de reabertura nomeada', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Passed — closed. Reopen only if something material changed.');
  });

  it('uma entidade activa continua exactamente como estava', () => {
    const e = entity({ status: 'not_contacted' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Ready for first contact — run pre-flight.');
  });
});

describe('nextPendingTaskDue', () => {
  it('devolve a mais proxima por vencer', () => {
    const t1 = task({ id: 'a', due_at: '2026-10-01T00:00:00.000Z' });
    const t2 = task({ id: 'b', due_at: '2026-09-01T00:00:00.000Z' });
    expect(nextPendingTaskDue(db(entity(), [t1, t2]), 'e1')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('ignora as feitas e as sem data', () => {
    const feita = task({ id: 'a', due_at: '2026-09-01T00:00:00.000Z', done: true });
    const semData = task({ id: 'b' });
    expect(nextPendingTaskDue(db(entity(), [feita, semData]), 'e1')).toBeUndefined();
  });

  it('nao mistura outras entidades', () => {
    const outra = task({ id: 'a', entity_id: 'outra', due_at: '2026-09-01T00:00:00.000Z' });
    expect(nextPendingTaskDue(db(entity(), [outra]), 'e1')).toBeUndefined();
  });
});
