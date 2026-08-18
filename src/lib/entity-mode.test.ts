import { describe, expect, it } from 'vitest';
import { entityMode, effectiveMode, nextBestAction, nextPendingTaskDue, needsReopenTrigger } from './relationship';
import type { Db, Entity, Interaction, TaskItem } from './types';

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

function db(
  e: Entity, tasks: TaskItem[] = [], interactions: Interaction[] = [],
  reawakeningProposals: Db['reawakeningProposals'] = [], rejectionCodes: Db['rejectionCodes'] = [],
): Db {
  return { entities: [e], interactions, people: [], tasks, relationshipState: [], reawakeningProposals, rejectionCodes } as unknown as Db;
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
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Parked — no revisit scheduled. No reopen trigger recorded — set one, or leave it dormant.');
  });

  it('dormant com revisit agendado: diz quando volta', () => {
    const e = entity({ status: 'dormant' });
    const t = task({ id: 't-rev', title: 'Revisit Test idividual', due_at: '2026-09-14T00:00:00.000Z' });
    expect(nextBestAction(db(e, [t]), 'e1', NOW)).toBe('Parked — revisit on 2026-09-14. No reopen trigger recorded — set one, or leave it dormant.');
  });

  it('o conselho antigo ("Ready for first contact") desaparece de todo', () => {
    const e = entity({ status: 'dormant' });
    expect(nextBestAction(db(e), 'e1', NOW)).not.toContain('pre-flight');
    expect(nextBestAction(db(e), 'e1', NOW)).not.toContain('first contact');
  });

  it('passed le-se fechado, sem gatilho nenhum registado -- pede para se definir um', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Passed. No reopen trigger recorded — set one, or leave it closed.');
  });

  it('uma entidade activa continua exactamente como estava', () => {
    const e = entity({ status: 'not_contacted' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Ready for first contact — run pre-flight.');
  });
});

// Prompt 251-B "Fase 0" — o BlueCrow case: um dossier fechado nao dizia NADA
// sobre reabrir. As quatro variantes que o prompt pediu, cada uma derivada
// so de dados que ja existem (reopen doctrine, migracao 0016) -- zero AI.
describe('nextBestAction — Fase 0: o Tip de reabertura num dossier fechado', () => {
  it('passed com pass classificado: cita a categoria e ha quanto tempo', () => {
    const e = entity({ status: 'passed' });
    const pass = { id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', pass_reason_category: 'stage_too_early', occurred_at: '2026-06-01T10:00:00.000Z' } as Interaction;
    expect(nextBestAction(db(e, [], [pass]), 'e1', NOW)).toBe('Passed 3 months ago, over stage too early. No reopen trigger recorded — set one, or leave it closed.');
  });

  it('reopen_trigger preenchido, sem eligible_after: cita-o verbatim', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'ablute_ ships an actual paying customer' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Reopens if: ablute_ ships an actual paying customer. Hasn\'t happened yet? Stays closed.');
  });

  it('reopen_eligible_after ja passou: diz elegivel, cita a categoria e o trigger', () => {
    const e = entity({
      status: 'passed', reopen_trigger: 'product live in market',
      reopen_eligible_after: '2026-08-01',
    });
    const pass = { id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', pass_reason_category: 'traction', occurred_at: '2026-06-01T10:00:00.000Z' } as Interaction;
    expect(nextBestAction(db(e, [], [pass]), 'e1', NOW))
      .toBe('Eligible for re-approach since 2026-08-01 — the earlier no was about traction; check whether "product live in market" has changed.');
  });

  it('reopen_eligible_after no FUTURO: ainda nao elegivel, cai para o trigger', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'DACH expansion', reopen_eligible_after: '2027-01-01' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Reopens if: DACH expansion. Hasn\'t happened yet? Stays closed.');
  });

  it('reopen_trigger que ja termina em pontuacao nao ganha ponto a mais', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'They raise a Series A.' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Reopens if: They raise a Series A. Hasn\'t happened yet? Stays closed.');
  });

  it('dormant com reopen_trigger: mesma logica, "stays dormant"', () => {
    const e = entity({ status: 'dormant', reopen_trigger: 'they raise a new fund' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Reopens if: they raise a new fund. Hasn\'t happened yet? Stays dormant.');
  });

  it('dormant com reopen_eligible_after ja passado: elegivel, sem categoria (nao houve pass)', () => {
    const e = entity({ status: 'dormant', reopen_eligible_after: '2026-08-10' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Eligible for re-approach since 2026-08-10.');
  });

  it('invested continua "Invested — closed." -- nao e uma recusa, nao precisa de reabertura', () => {
    const e = entity({ status: 'invested' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Invested — closed.');
  });

  it('humanizeAge: menos de 60 dias fica em dias', () => {
    const e = entity({ status: 'passed' });
    const pass = { id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', occurred_at: '2026-08-01T10:00:00.000Z' } as Interaction;
    expect(nextBestAction(db(e, [], [pass]), 'e1', NOW)).toContain('14 days ago');
  });

  it('humanizeAge: mais de 2 anos fica em anos', () => {
    const e = entity({ status: 'passed' });
    const pass = { id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', occurred_at: '2023-08-15T10:00:00.000Z' } as Interaction;
    expect(nextBestAction(db(e, [], [pass]), 'e1', NOW)).toContain('3 years ago');
  });
});

// Prompt 251/253 Bloco B/C — a pending code-triggered reactivation takes
// priority over the generic Fase-0 copy above, and Bloc C fixed the
// multi-code case (was a silent `.find`, dropped every reason past the
// first).
describe('nextBestAction — reativacao por codigo (Bloco B/C)', () => {
  function proposal(over: Partial<Db['reawakeningProposals'][0]> = {}): Db['reawakeningProposals'][0] {
    return {
      id: 'rwp1', entity_id: 'e1', rejection_code_id: 'rc1', reopens: true, status: 'pending',
      rationale: 'Passed earlier over stage (needed: series_a) — that bar looks cleared now.',
      created_at: '2026-08-15T00:00:00.000Z', ...over,
    } as unknown as Db['reawakeningProposals'][0];
  }

  it('uma proposta pendente: mostra a razao completa, com o icone', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e, [], [], [proposal()]), 'e1', NOW))
      .toBe('↻ Passed earlier over stage (needed: series_a) — that bar looks cleared now.');
  });

  it('ganha ao Fase 0 mesmo com reopen_trigger tambem preenchido', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'they raise a Series A' });
    expect(nextBestAction(db(e, [], [], [proposal()]), 'e1', NOW)).toContain('↻');
  });

  it('duas propostas pendentes: nomeia os dois eixos, nao so o primeiro', () => {
    const e = entity({ status: 'passed' });
    const p1 = proposal({ id: 'rwp1', rejection_code_id: 'rc-stage' });
    const p2 = proposal({ id: 'rwp2', rejection_code_id: 'rc-sector', rationale: 'Passed earlier over sector...' });
    const codes = [
      { id: 'rc-stage', entity_id: 'e1', axis_code: 'stage', required_level: 2, level_label: 'series_a', created_at: NOW.toISOString() },
      { id: 'rc-sector', entity_id: 'e1', axis_code: 'sector', required_level: 1, level_label: 'digital health', created_at: NOW.toISOString() },
    ] as Db['rejectionCodes'];
    const result = nextBestAction(db(e, [], [], [p1, p2], codes), 'e1', NOW);
    expect(result).toContain('stage');
    expect(result).toContain('sector');
    expect(result).toContain('2 bars cleared');
  });

  it('proposta ja resolvida (approved/rejected) nao conta', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e, [], [], [proposal({ status: 'approved' })]), 'e1', NOW)).not.toContain('↻');
  });

  it('proposta com reopens:false (dismissed) nao conta', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e, [], [], [proposal({ reopens: false })]), 'e1', NOW)).not.toContain('↻');
  });

  it('proposta de outra entidade nao vaza para esta', () => {
    const e = entity({ status: 'passed' });
    expect(nextBestAction(db(e, [], [], [proposal({ entity_id: 'outra' })]), 'e1', NOW)).not.toContain('↻');
  });
});

describe('needsReopenTrigger', () => {
  it('true quando passed/dormant sem nada registado', () => {
    expect(needsReopenTrigger({ status: 'passed', reopen_trigger: undefined, reopen_eligible_after: undefined })).toBe(true);
    expect(needsReopenTrigger({ status: 'dormant', reopen_trigger: undefined, reopen_eligible_after: undefined })).toBe(true);
  });

  it('false com reopen_trigger OU reopen_eligible_after preenchido', () => {
    expect(needsReopenTrigger({ status: 'passed', reopen_trigger: 'x', reopen_eligible_after: undefined })).toBe(false);
    expect(needsReopenTrigger({ status: 'passed', reopen_trigger: undefined, reopen_eligible_after: '2026-08-01' })).toBe(false);
  });

  it('false para estados activos ou invested -- nao e uma recusa por resolver', () => {
    expect(needsReopenTrigger({ status: 'contacted', reopen_trigger: undefined, reopen_eligible_after: undefined })).toBe(false);
    expect(needsReopenTrigger({ status: 'invested', reopen_trigger: undefined, reopen_eligible_after: undefined })).toBe(false);
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

// Prompt 209 (resto) — a precedencia tem de valer na pagina inteira, nao so
// no stepper. Caso real da Adara: classificada como pass e SO DEPOIS
// parqueada ("Manually parked", dormant_since 2026-08-16 12:16).
describe('effectiveMode — fechado ganha a parqueado', () => {
  function withInbound(over: Partial<Interaction>) {
    return {
      id: 'i', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      occurred_at: '2026-08-05T10:00:00.000Z', ...over,
    } as Interaction;
  }

  it('dormant + ultimo inbound pass = closed', () => {
    const e = entity({ status: 'dormant' });
    expect(effectiveMode(db(e, [], [withInbound({ classification: 'pass' })]), 'e1')).toBe('closed');
  });

  it('dormant sem pass continua parked', () => {
    const e = entity({ status: 'dormant' });
    expect(effectiveMode(db(e, [], [withInbound({ classification: 'interested' })]), 'e1')).toBe('parked');
  });

  it('conta o ULTIMO inbound: um pass antigo seguido de resposta nova nao fecha', () => {
    const e = entity({ status: 'dormant' });
    const antigo = withInbound({ id: 'a', classification: 'pass', occurred_at: '2026-01-01T00:00:00.000Z' });
    const novo = withInbound({ id: 'b', classification: 'interested', occurred_at: '2026-08-05T10:00:00.000Z' });
    expect(effectiveMode(db(e, [], [antigo, novo]), 'e1')).toBe('parked');
  });

  it('status passed e closed mesmo sem interacoes', () => {
    expect(effectiveMode(db(entity({ status: 'passed' }), [], []), 'e1')).toBe('closed');
  });

  it('activo sem pass continua activo', () => {
    expect(effectiveMode(db(entity({ status: 'contacted' }), [], [withInbound({ classification: 'question' })]), 'e1')).toBe('active');
  });
});

describe('nextBestAction — a pagina inteira concorda', () => {
  it('dormant + pass NAO diz "Parked", diz que esta fechado', () => {
    const e = entity({ status: 'dormant' });
    const d = db(e, [], [{ id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', occurred_at: '2026-08-05T10:00:00.000Z' } as Interaction]) as Db;

    const acao = nextBestAction(d, 'e1', NOW);
    expect(acao).toBe('Passed 10 days ago. No reopen trigger recorded — set one, or leave it closed.');
    expect(acao).not.toContain('Parked');
  });
});
