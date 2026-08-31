import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_STALE_AFTER_DAYS, planAutomationRulesTick, type AutomationRulesTickInput, type OpenTaskSlice } from './automation-rules-tick';
import type { Entity, Interaction, Person } from './types';

const NOW = new Date('2026-08-31T09:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function entity(over: Partial<Entity> & { id: string }): Entity {
  return {
    name: `Entity ${over.id}`, type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, status: 'contacted', hard_filter_status: 'none',
    submission_channel_type: 'none', ...over,
  } as Entity;
}

function person(over: Partial<Person> & { id: string; entity_id: string }): Person {
  return {
    full_name: `Person ${over.id}`, seniority_rank: 1, linkedin_verified: false, bounce_count: 0,
    linked_companies: [], linked_funds: [], hook_status: 'researched', kill_words: [],
    preferred_language: 'en', privacy_notice_sent: false, do_not_contact: false, ...over,
  } as Person;
}

function out(entity_id: string, person_id: string | undefined, occurred_at: string): Interaction {
  return { id: `i-${entity_id}-${occurred_at}`, entity_id, person_id, occurred_at, direction: 'out', channel: 'email' } as Interaction;
}

function input(over: Partial<AutomationRulesTickInput> = {}): AutomationRulesTickInput {
  return {
    db: { interactions: [], people: [], entities: [] },
    openTasks: [], followUpEnabled: true, dormantEnabled: true, maxPerTick: 20, now: NOW, ...over,
  };
}

describe('planAutomationRulesTick — o caso base', () => {
  it('cria uma tarefa de follow-up para um outbound sem resposta há mais de 14 dias', () => {
    const e = entity({ id: 'e1' });
    const p = person({ id: 'p1', entity_id: 'e1' });
    const plan = planAutomationRulesTick(input({
      db: { entities: [e], people: [p], interactions: [out('e1', 'p1', daysAgo(20))] },
    }));
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      source: 'automation_follow_up', kind: 'follow_up', action_type: 'follow_up_no_reply',
      entity_id: 'e1', person_id: 'p1',
    });
  });

  it('não cria nada antes dos 14 dias (o limiar é de rules.ts, não daqui)', () => {
    const plan = planAutomationRulesTick(input({
      db: { entities: [entity({ id: 'e1' })], people: [person({ id: 'p1', entity_id: 'e1' })], interactions: [out('e1', 'p1', daysAgo(5))] },
    }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.considered).toBe(0);
  });
});

describe('planAutomationRulesTick — não duplicar entre corridas', () => {
  const db = {
    entities: [entity({ id: 'e1' })],
    people: [person({ id: 'p1', entity_id: 'e1' })],
    interactions: [out('e1', 'p1', daysAgo(20))],
  };

  it('salta uma entidade que já tem a tarefa criada por uma corrida anterior', () => {
    const openTasks: OpenTaskSlice[] = [{ entity_id: 'e1', kind: 'follow_up', source: 'automation_follow_up' }];
    const plan = planAutomationRulesTick(input({ db, openTasks }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.alreadyOpen).toBe(1);
  });

  it('salta também a tarefa de follow-up que logInteraction já cria (source nulo)', () => {
    const openTasks: OpenTaskSlice[] = [{ entity_id: 'e1', kind: 'follow_up', source: undefined }];
    expect(planAutomationRulesTick(input({ db, openTasks })).tasks).toHaveLength(0);
  });

  it('volta a criar depois de a tarefa anterior ser fechada (openTasks só traz done = false)', () => {
    expect(planAutomationRulesTick(input({ db, openTasks: [] })).tasks).toHaveLength(1);
  });

  it('não é confundido por uma tarefa aberta de outra entidade', () => {
    const openTasks: OpenTaskSlice[] = [{ entity_id: 'e2', kind: 'follow_up', source: 'automation_follow_up' }];
    expect(planAutomationRulesTick(input({ db, openTasks })).tasks).toHaveLength(1);
  });

  it('é idempotente dentro da MESMA corrida (duas entradas para a mesma entidade só dão uma tarefa)', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1' }), entity({ id: 'e2' })],
        people: [person({ id: 'p1', entity_id: 'e1' })],
        interactions: [out('e1', 'p1', daysAgo(20)), out('e1', 'p1', daysAgo(30))],
      },
    }));
    // duas mensagens sem resposta = segundo silêncio: uma proposta de dormente, nunca duas
    expect(plan.tasks.filter((t) => t.entity_id === 'e1')).toHaveLength(1);
  });
});

describe('planAutomationRulesTick — segundo silêncio nunca vira terceira mensagem', () => {
  it('propõe dormente em vez de outro follow-up', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1', name: 'Nina Capital' })],
        people: [person({ id: 'p1', entity_id: 'e1' })],
        interactions: [out('e1', 'p1', daysAgo(40)), out('e1', 'p1', daysAgo(20))],
      },
    }));
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].source).toBe('automation_dormant');
    expect(plan.tasks[0].kind).toBe('admin');
    expect(plan.tasks[0].title).toContain('Nina Capital');
  });

  it('respeita o interruptor de cada automação em separado', () => {
    const db = {
      entities: [entity({ id: 'e1' }), entity({ id: 'e2' })],
      people: [person({ id: 'p1', entity_id: 'e1' }), person({ id: 'p2', entity_id: 'e2' })],
      interactions: [out('e1', 'p1', daysAgo(20)), out('e2', 'p2', daysAgo(40)), out('e2', 'p2', daysAgo(20))],
    };
    expect(planAutomationRulesTick(input({ db, dormantEnabled: false })).tasks.map((t) => t.source)).toEqual(['automation_follow_up']);
    expect(planAutomationRulesTick(input({ db, followUpEnabled: false })).tasks.map((t) => t.source)).toEqual(['automation_dormant']);
    expect(planAutomationRulesTick(input({ db, followUpEnabled: false, dormantEnabled: false })).tasks).toHaveLength(0);
  });
});

describe('planAutomationRulesTick — o que nunca deve gerar trabalho', () => {
  it('ignora um silêncio mais antigo que o tecto de obsolescência', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1' })], people: [person({ id: 'p1', entity_id: 'e1' })],
        interactions: [out('e1', 'p1', daysAgo(FOLLOW_UP_STALE_AFTER_DAYS + 1))],
      },
    }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.stale).toBe(1);
    expect(plan.considered).toBe(1); // rules.ts devolveu-a; o filtro é daqui
  });

  it.each(['passed', 'invested', 'dormant'] as const)('ignora entidades em estado terminal (%s)', (status) => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1', status })], people: [person({ id: 'p1', entity_id: 'e1' })],
        interactions: [out('e1', 'p1', daysAgo(20))],
      },
    }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.terminalStatus).toBe(1);
  });

  it('nunca propõe follow-up a um contacto do_not_contact', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1' })], people: [person({ id: 'p1', entity_id: 'e1', do_not_contact: true })],
        interactions: [out('e1', 'p1', daysAgo(20))],
      },
    }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.doNotContact).toBe(1);
  });
});

describe('planAutomationRulesTick — o tecto por corrida', () => {
  const many = Array.from({ length: 30 }, (_, n) => n);
  const db = {
    entities: many.map((n) => entity({ id: `e${n}` })),
    people: many.map((n) => person({ id: `p${n}`, entity_id: `e${n}` })),
    interactions: many.map((n) => out(`e${n}`, `p${n}`, daysAgo(20 + n))),
  };

  it('nunca cria mais do que o tecto numa corrida, e diz quantas ficaram de fora', () => {
    const plan = planAutomationRulesTick(input({ db, maxPerTick: 20 }));
    expect(plan.tasks).toHaveLength(20);
    expect(plan.skipped.overCap).toBe(10);
  });

  it('o que corta são os threads mais antigos, não os mais recentes', () => {
    const plan = planAutomationRulesTick(input({ db, maxPerTick: 3 }));
    expect(plan.tasks.map((t) => t.entity_id)).toEqual(['e0', 'e1', 'e2']);
  });
});

describe('planAutomationRulesTick — o padrão de passes', () => {
  const pass = (entity_id: string, category: string): Interaction => ({
    id: `p-${entity_id}`, entity_id, occurred_at: daysAgo(3), direction: 'in', channel: 'email',
    classification: 'pass', pass_reason_category: category,
  } as Interaction);

  it('não dispara com 2 entidades a passar pela mesma razão', () => {
    const plan = planAutomationRulesTick(input({
      db: { entities: [], people: [], interactions: [pass('e1', 'stage'), pass('e2', 'stage')] },
    }));
    expect(plan.passPattern).toBeNull();
  });

  it('dispara a partir de 3, e nunca vira tarefa (já é visível ao vivo noutras duas superfícies)', () => {
    const plan = planAutomationRulesTick(input({
      db: { entities: [], people: [], interactions: [pass('e1', 'stage'), pass('e2', 'stage'), pass('e3', 'stage')] },
    }));
    expect(plan.passPattern).toEqual({ category: 'stage', count: 3 });
    expect(plan.tasks).toHaveLength(0);
  });
});
