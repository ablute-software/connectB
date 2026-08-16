import { describe, expect, it } from 'vitest';
import { journeySteps, docsByStage, stageChangeAt } from './journey';
import { STAGE_LABEL } from './relationship';
import type { Db, Entity, Interaction, RelationshipState } from './types';

// Prompt 206-C + 209 — casos reais: Adara Ventures (percorrido
// [contacted, engaged], desfecho declined, deck partilhado em contacted) e
// "Test idividual" (parqueada).

function entity(over: Partial<Entity> = {}): Entity {
  return { id: 'adara', name: 'Adara Ventures', type: 'vc', status: 'contacted', ...over } as Entity;
}

function inter(over: Partial<Interaction>): Interaction {
  return {
    id: 'i', entity_id: 'adara', direction: 'in', channel: 'email',
    content: '...', occurred_at: '2026-08-05T10:00:00.000Z', ...over,
  } as Interaction;
}

function stageChange(stage: keyof typeof STAGE_LABEL, at: string, id = `sc-${stage}`): Interaction {
  return inter({ id, direction: 'out', channel: 'stage_change', content: `Stage changed to ${STAGE_LABEL[stage]}.`, occurred_at: at });
}

function db(interactions: Interaction[], e: Entity = entity(), state: RelationshipState[] = [], tasks: unknown[] = []): Db {
  return { entities: [e], interactions, relationshipState: state, people: [], tasks } as unknown as Db;
}

const OUT = inter({ id: 'out', direction: 'out', classification: 'awaiting', occurred_at: '2025-11-27T10:00:00.000Z' });
const PASS = inter({ id: 'pass', classification: 'pass', pass_reason_category: 'thesis_mismatch', occurred_at: '2026-08-05T10:00:00.000Z' });

describe('stageChangeAt', () => {
  it('le o estagio do texto gravado', () => {
    expect(stageChangeAt(stageChange('engaged', '2026-01-01T00:00:00.000Z'))).toBe('engaged');
  });

  it('ignora o que nao e stage_change', () => {
    expect(stageChangeAt(OUT)).toBeUndefined();
  });

  it('um rotulo que nao casa e ignorado, nao adivinhado', () => {
    const estranho = inter({ channel: 'stage_change', content: 'Stage changed to Whatever.' });
    expect(stageChangeAt(estranho)).toBeUndefined();
  });
});

describe('journeySteps — fechado (o caso Adara)', () => {
  const passed = entity({ status: 'passed' });

  it('so os passos percorridos, todos com done, e o desfecho no fim', () => {
    const steps = journeySteps(db([OUT, PASS], passed), 'adara');

    expect(steps.map((s) => s.kind)).toEqual(['stage', 'stage', 'outcome']);
    expect(steps.filter((s) => s.kind === 'stage').every((s) => s.kind === 'stage' && s.state === 'done')).toBe(true);
  });

  it('percorrido e [contacted, engaged] quando houve resposta', () => {
    const steps = journeySteps(db([OUT, PASS], passed), 'adara');
    expect(steps.filter((s) => s.kind === 'stage').map((s) => s.kind === 'stage' && s.stage))
      .toEqual(['contacted', 'engaged']);
  });

  it('NAO inclui Meeting nem Diligence -- e o ruido que o 209 veio tirar', () => {
    const stages = journeySteps(db([OUT, PASS], passed), 'adara')
      .filter((s) => s.kind === 'stage').map((s) => s.kind === 'stage' && s.stage);
    expect(stages).not.toContain('meeting');
    expect(stages).not.toContain('diligence');
  });

  it('o desfecho leva data e categoria do pass, para o hover', () => {
    const outcome = journeySteps(db([OUT, PASS], passed), 'adara').at(-1);
    expect(outcome).toMatchObject({ kind: 'outcome', outcome: 'declined', passCategory: 'thesis_mismatch' });
    expect(outcome?.kind === 'outcome' && outcome.at?.slice(0, 10)).toBe('2026-08-05');
  });

  it('invested da o desfecho verde, nao declined', () => {
    const inv = entity({ status: 'invested' });
    expect(journeySteps(db([OUT], inv), 'adara').at(-1)).toMatchObject({ kind: 'outcome', outcome: 'invested' });
  });

  it('sem resposta nenhuma, percorrido e so [contacted]', () => {
    const steps = journeySteps(db([OUT], entity({ status: 'passed' })), 'adara');
    expect(steps.filter((s) => s.kind === 'stage').map((s) => s.kind === 'stage' && s.stage)).toEqual(['contacted']);
  });

  it('usa as stage_change reais quando existem', () => {
    const steps = journeySteps(db([
      OUT, stageChange('contacted', '2025-11-28T00:00:00.000Z'), stageChange('engaged', '2026-02-01T00:00:00.000Z'),
      stageChange('meeting', '2026-03-01T00:00:00.000Z'), PASS,
    ], passed), 'adara');
    expect(steps.filter((s) => s.kind === 'stage').map((s) => s.kind === 'stage' && s.stage))
      .toEqual(['contacted', 'engaged', 'meeting']);
  });
});

describe('journeySteps — parqueado nao e desfecho', () => {
  it('mantem o stepper todo e acrescenta o chip de parked', () => {
    const parked = entity({ id: 'test', name: 'Test idividual', status: 'dormant' });
    const steps = journeySteps(
      { entities: [parked], interactions: [inter({ entity_id: 'test', id: 'x', classification: 'interested' })],
        relationshipState: [], people: [],
        tasks: [{ id: 't', title: 'Revisit', entity_id: 'test', done: false, due_at: '2026-09-14T00:00:00.000Z' }] } as unknown as Db,
      'test');

    expect(steps.at(-1)).toEqual({ kind: 'parked', revisitAt: '2026-09-14T00:00:00.000Z' });
    expect(steps.filter((s) => s.kind === 'stage')).toHaveLength(6);
  });
});

describe('journeySteps — activo nao muda', () => {
  it('todos os estagios, com o efectivo em current', () => {
    const steps = journeySteps(db([OUT, inter({ id: 'r', classification: 'question' })]), 'adara');
    expect(steps.filter((s) => s.kind === 'stage')).toHaveLength(6);
    const current = steps.find((s) => s.kind === 'stage' && s.state === 'current');
    expect(current).toMatchObject({ stage: 'engaged' });
  });
});

describe('docsByStage', () => {
  const DECK = inter({ id: 'd1', direction: 'out', document_id: 'deck', occurred_at: '2025-11-27T10:00:00.000Z' });

  it('documento partilhado antes de qualquer stage_change fica no primeiro passo', () => {
    const m = docsByStage(db([DECK, inter({ id: 'r', classification: 'question' })]), 'adara');
    expect(m.get('contacted')?.map((d) => d.documentId)).toEqual(['deck']);
  });

  it('ancora ao estagio em vigor A DATA da partilha', () => {
    const m = docsByStage(db([
      DECK,
      stageChange('engaged', '2026-01-01T00:00:00.000Z'),
      inter({ id: 'd2', direction: 'out', document_id: 'memo', occurred_at: '2026-02-01T00:00:00.000Z' }),
    ]), 'adara');

    expect(m.get('contacted')?.map((d) => d.documentId)).toEqual(['deck']);
    expect(m.get('engaged')?.map((d) => d.documentId)).toEqual(['memo']);
  });

  it('varios no mesmo passo saem por ordem cronologica', () => {
    const m = docsByStage(db([
      inter({ id: 'b', direction: 'out', document_id: 'segundo', occurred_at: '2026-01-05T00:00:00.000Z' }),
      inter({ id: 'a', direction: 'out', document_id: 'primeiro', occurred_at: '2026-01-02T00:00:00.000Z' }),
    ]), 'adara');
    expect(m.get('contacted')?.map((d) => d.documentId)).toEqual(['primeiro', 'segundo']);
  });

  it('interacoes sem documento nao entram', () => {
    expect(docsByStage(db([OUT, PASS]), 'adara').size).toBe(0);
  });

  it('guarda o id da interacao, para a ancora "ver no historico"', () => {
    const m = docsByStage(db([DECK]), 'adara');
    expect(m.get('contacted')?.[0].interactionId).toBe('d1');
  });
});
