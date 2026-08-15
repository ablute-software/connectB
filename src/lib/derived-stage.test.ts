import { describe, expect, it } from 'vitest';
import { derivedStage, derivedStageFromFacts } from './derived-stage';
import type { Db, Entity, Interaction, RelationshipState } from './types';

// Prompt 206-A — os quatro casos nomeados no prompt, com os dados reais que o
// Nuno tem à frente: Adara Ventures e "Test idividual".

function entity(over: Partial<Entity> = {}): Entity {
  return { id: 'adara', name: 'Adara Ventures', type: 'vc', status: 'contacted', ...over } as Entity;
}

function inter(over: Partial<Interaction>): Interaction {
  return {
    id: 'i', entity_id: 'adara', direction: 'in', channel: 'email',
    content: '...', occurred_at: '2026-08-05T10:00:00.000Z', ...over,
  } as Interaction;
}

function db(interactions: Interaction[], e: Entity = entity(), state: RelationshipState[] = []): Db {
  return { entities: [e], interactions, relationshipState: state, people: [], tasks: [] } as unknown as Db;
}

const OUT = inter({ id: 'out', direction: 'out', classification: 'awaiting', occurred_at: '2025-11-27T10:00:00.000Z' });

describe('derivedStageFromFacts', () => {
  it('sem nada: not_contacted', () => {
    expect(derivedStageFromFacts(db([]), 'adara').stage).toBe('not_contacted');
  });

  it('so outbound: contacted', () => {
    expect(derivedStageFromFacts(db([OUT]), 'adara').stage).toBe('contacted');
  });

  it('houve resposta: engaged', () => {
    expect(derivedStageFromFacts(db([OUT, inter({ id: 'r', classification: 'question' })]), 'adara').stage).toBe('engaged');
  });

  it('reuniao registada: meeting', () => {
    const m = inter({ id: 'm', direction: 'out', channel: 'meeting', occurred_at: '2026-08-02T10:00:00.000Z' });
    expect(derivedStageFromFacts(db([OUT, m]), 'adara').stage).toBe('meeting');
  });

  it('pass classificado: decision, e ganha ate a uma reuniao anterior', () => {
    const m = inter({ id: 'm', direction: 'out', channel: 'meeting', occurred_at: '2026-08-02T10:00:00.000Z' });
    const p = inter({ id: 'p', classification: 'pass', occurred_at: '2026-08-05T10:00:00.000Z' });
    const r = derivedStageFromFacts(db([OUT, m, p]), 'adara');
    expect(r.stage).toBe('decision');
    expect(r.reason).toContain('pass');
  });
});

describe('derivedStage — o caso Adara', () => {
  const MANUAL_ENGAGED: RelationshipState[] = [{ entity_id: 'adara', stage: 'engaged', updated_at: '2026-08-01T00:00:00.000Z' }];

  it('pass classificado + stepper manual em Engaged: os factos ganham', () => {
    const p = inter({ id: 'p', classification: 'pass' });
    const r = derivedStage(db([OUT, p], entity(), MANUAL_ENGAGED), 'adara');

    expect(r.derived).toBe('decision');
    expect(r.manual).toBe('engaged');
    expect(r.contradicted).toBe(true);
    expect(r.effective).toBe('decision');   // <- o stepper deixa de mentir
  });

  // O estado REAL em producao hoje: o inbound do pass ficou 'awaiting'
  // porque foi gravado antes do 202 §A.1 obrigar a classificacao.
  it('pass POR CLASSIFICAR: nao inventa o pass, mas grita que ha resposta por classificar', () => {
    const porClassificar = inter({ id: 'p', classification: 'awaiting' });
    const r = derivedStage(db([OUT, porClassificar], entity(), MANUAL_ENGAGED), 'adara');

    expect(r.derived).toBe('engaged');          // responderam -- so isso se sabe
    expect(r.contradicted).toBe(false);         // nao ha contradicao provada
    expect(r.unclassifiedReplies).toBe(1);      // mas ha um chip a pedir a classificacao
  });

  it('depois de classificado, o mesmo dado passa a contradizer', () => {
    const classificado = inter({ id: 'p', classification: 'pass' });
    expect(derivedStage(db([OUT, classificado], entity(), MANUAL_ENGAGED), 'adara').contradicted).toBe(true);
  });
});

describe('derivedStage — override manual legitimo', () => {
  // 'diligence' nao tem facto nenhum que a produza. Se qualquer diferenca
  // fosse tratada como suspeita, este founder via um aviso para sempre.
  it('manual A FRENTE do derivado nao e contradicao', () => {
    const r = derivedStage(db([OUT, inter({ id: 'r', classification: 'interested' })], entity(),
      [{ entity_id: 'adara', stage: 'diligence', updated_at: '2026-08-01T00:00:00.000Z' }]), 'adara');

    expect(r.contradicted).toBe(false);
    expect(r.manualAhead).toBe(true);
    expect(r.effective).toBe('diligence');  // o founder sabe coisas que a app nao sabe
  });

  it('sem linha manual nenhuma, o efectivo e o derivado', () => {
    const r = derivedStage(db([OUT]), 'adara');
    expect(r.manual).toBeUndefined();
    expect(r.manualAhead).toBe(false);
    expect(r.effective).toBe('contacted');
  });
});

describe('derivedStage — "Test idividual" parqueada', () => {
  it('dormant le-se parked, sem deixar de ter estagio derivado', () => {
    const e = entity({ id: 'test', name: 'Test idividual', status: 'dormant' });
    const r = derivedStage({ entities: [e], interactions: [inter({ entity_id: 'test', id: 'x', classification: 'interested' })], relationshipState: [], people: [], tasks: [] } as unknown as Db, 'test');

    expect(r.mode).toBe('parked');
    expect(r.derived).toBe('engaged');
  });

  it('passed le-se closed', () => {
    const e = entity({ status: 'passed' });
    expect(derivedStage(db([OUT], e), 'adara').mode).toBe('closed');
  });
});

describe('derivedStage — contagem de respostas por classificar', () => {
  it('conta so as recebidas, e so as por classificar', () => {
    const r = derivedStage(db([
      OUT,
      inter({ id: 'a', classification: 'awaiting' }),
      inter({ id: 'b', classification: 'interested' }),
      inter({ id: 'c', classification: 'awaiting' }),
    ]), 'adara');

    expect(r.unclassifiedReplies).toBe(2);
  });

  it('um inbound sem classificacao nenhuma conta tambem', () => {
    expect(derivedStage(db([OUT, inter({ id: 'a', classification: undefined })]), 'adara').unclassifiedReplies).toBe(1);
  });
});
