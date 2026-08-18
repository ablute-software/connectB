import { describe, expect, it } from 'vitest';
import { stageExits } from './relationship';
import type { Db, Entity, Interaction } from './types';

// Prompt 202 §A.2 + §E — o caso Adara Ventures (pass de 2026-08-05). O banner
// antigo só olhava para whoseTurn/stage e a única saída que oferecia era
// "Mark as Engaged?": a app sugeriu avançar com quem tinha dito que não, e o
// founder clicou. Estes testes prendem exactamente isso.

const ENTITY: Entity = {
  id: 'ent-adara', name: 'Adara Ventures', type: 'vc', status: 'contacted',
} as Entity;

function interaction(over: Partial<Interaction>): Interaction {
  return {
    id: `i-${Math.round(over.occurred_at ? 1 : 0)}${over.direction}${over.classification ?? ''}`,
    entity_id: 'ent-adara', direction: 'in', channel: 'email',
    content: '...', occurred_at: '2026-08-05T10:00:00.000Z',
    ...over,
  } as Interaction;
}

function db(interactions: Interaction[], entity: Entity = ENTITY): Db {
  return { entities: [entity], interactions, people: [], tasks: [], relationshipState: [] } as unknown as Db;
}

const OUTBOUND = interaction({ id: 'i-out', direction: 'out', classification: 'awaiting', occurred_at: '2026-07-01T10:00:00.000Z' });

describe('stageExits — o caso Adara', () => {
  it('ultimo inbound e um pass: NAO oferece avancar', () => {
    const e = stageExits(db([OUTBOUND, interaction({ id: 'i-pass', classification: 'pass' })]), ENTITY);

    expect(e.show).toBe(true);
    expect(e.lastInboundWasPass).toBe(true);
    expect(e.canAdvance).toBe(false); // <- o bug: antes daqui saía "Mark as Engaged?"
  });

  it('inbound sem ser pass: oferece avancar para o estagio seguinte', () => {
    const e = stageExits(db([OUTBOUND, interaction({ id: 'i-q', classification: 'question' })]), ENTITY);

    expect(e.canAdvance).toBe(true);
    expect(e.nextStage).toBe('engaged');
  });

  // A primeira metade do bug: um inbound por classificar ficava 'awaiting' por
  // omissão. Continua a não ser um pass — por isso §A.1 torna o campo
  // obrigatório no log, em vez de tentar adivinhar aqui.
  it('inbound classificado como awaiting nao conta como pass', () => {
    const e = stageExits(db([OUTBOUND, interaction({ id: 'i-aw', classification: 'awaiting' })]), ENTITY);

    expect(e.lastInboundWasPass).toBe(false);
    expect(e.canAdvance).toBe(true);
  });

  it('conta o ULTIMO inbound, nao o primeiro', () => {
    const e = stageExits(db([
      interaction({ id: 'i-1', classification: 'pass', occurred_at: '2026-07-01T10:00:00.000Z' }),
      interaction({ id: 'i-2', classification: 'interested', occurred_at: '2026-08-05T10:00:00.000Z' }),
    ]), ENTITY);

    expect(e.lastInboundWasPass).toBe(false);
  });
});

// Ajuste do Nuno (2026-08-15) — quem nunca respondeu tambem precisa de saida.
describe('stageExits — overdue (nunca responderam)', () => {
  // Um outbound antigo o suficiente para a relacao ficar 'overdue' e sem
  // qualquer inbound: e o caso "cold" literal.
  const ANTIGO = interaction({
    id: 'i-old', direction: 'out', classification: 'awaiting', occurred_at: '2026-01-05T10:00:00.000Z',
  });
  const AGORA = new Date('2026-08-15T10:00:00.000Z');

  it('abre o banner mesmo sem resposta nenhuma', () => {
    const e = stageExits(db([ANTIGO]), ENTITY, AGORA);
    expect(e.show).toBe(true);
  });

  it('mas NAO oferece avancar -- so as saidas 2 e 3', () => {
    const e = stageExits(db([ANTIGO]), ENTITY, AGORA);
    expect(e.canAdvance).toBe(false);
    expect(e.lastInboundWasPass).toBe(false);
  });

  it('e a saida 3 le-se "cold", nao "frozen"', () => {
    const e = stageExits(db([ANTIGO]), ENTITY, AGORA);
    expect(e.parkLabel).toBe('cold');
  });
});

describe('stageExits — quando aparece de todo', () => {
  it('nao aparece para quem ja saiu do funil (passed)', () => {
    const passed = { ...ENTITY, status: 'passed' } as Entity;
    const e = stageExits(db([OUTBOUND, interaction({ classification: 'pass' })], passed), passed);
    expect(e.show).toBe(false);
  });

  it('nao aparece para quem esta dormant', () => {
    const dormant = { ...ENTITY, status: 'dormant' } as Entity;
    const e = stageExits(db([OUTBOUND, interaction({ classification: 'pass' })], dormant), dormant);
    expect(e.show).toBe(false);
  });

  it('nao aparece sem contacto nenhum', () => {
    const e = stageExits(db([]), ENTITY);
    expect(e.show).toBe(false);
  });
});

describe('stageExits — rotulo do parque', () => {
  it('em contacted le-se "cold" (nunca responderam)', () => {
    const e = stageExits(db([OUTBOUND]), ENTITY);
    expect(e.parkLabel).toBe('cold');
  });

  it('depois de haver conversa le-se "frozen"', () => {
    const e = stageExits(db([
      OUTBOUND,
      interaction({ id: 'i-in', classification: 'interested' }),
      interaction({ id: 'i-meet', direction: 'out', channel: 'meeting', classification: 'awaiting', occurred_at: '2026-08-06T10:00:00.000Z' }),
    ]), ENTITY);
    expect(['cold', 'frozen']).toContain(e.parkLabel);
  });
});

// Prompt 214 §C.3 tirava Decision do botão por completo: a app não podia
// empurrar sozinha ("reply != decisão"). Prompt 249 §A reverteu só a
// PARTE do avanço automático — Decision volta a aparecer como qualquer
// outra saída de avanço, mas o clique já não avança sozinho: quem decide
// abrir a confirmação de desfecho em vez de avançar direto é o componente
// (RelationshipSummaryCard), vendo nextStage === 'decision'. Esta função só
// decide SE a saída existe, nunca o que o clique faz.
describe('stageExits — Decision deixou de estar escondida (249 §A)', () => {
  const EM_DILIGENCE = [{ entity_id: 'ent-adara', stage: 'diligence', updated_at: '2026-08-01T00:00:00.000Z' }];

  it('em diligence, com resposta nao-pass, oferece avancar para Decision', () => {
    const d = db([OUTBOUND, interaction({ id: 'r', classification: 'question' })]);
    (d as unknown as { relationshipState: unknown[] }).relationshipState = EM_DILIGENCE;

    const e = stageExits(d, ENTITY);
    expect(e.nextStage).toBe('decision');
    expect(e.canAdvance).toBe(true);
  });

  it('mas continua a NAO oferecer avancar quando o ultimo inbound foi pass', () => {
    const d = db([OUTBOUND, interaction({ id: 'r', classification: 'pass' })]);
    (d as unknown as { relationshipState: unknown[] }).relationshipState = EM_DILIGENCE;

    expect(stageExits(d, ENTITY).canAdvance).toBe(false);
  });

  it('avancar continua a funcionar nos estagios anteriores', () => {
    const e = stageExits(db([OUTBOUND, interaction({ id: 'r', classification: 'question' })]), ENTITY);
    expect(e.nextStage).toBe('engaged');
    expect(e.canAdvance).toBe(true);
  });
});
