import { describe, expect, it } from 'vitest';
import {
  DORMANT_DECLINE_SUPPRESS_MONTHS, FOLLOW_UP_STALE_AFTER_DAYS, dormantDeclineSuppressed,
  planAutomationRulesTick, type AutomationRulesTickInput, type OpenTaskSlice,
} from './automation-rules-tick';
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

// Prompt 883 §3 — Decline suppresses re-proposing the identical decision
// for 6 months, unless a new interaction clears it first.
describe('dormantDeclineSuppressed', () => {
  // Day 15 on purpose — every month has one, so setMonth arithmetic here
  // never hits the Jan-31-minus-a-month-has-no-31st overflow trap that
  // NOW (2026-08-31) would (setMonth(-6) from the 31st rolls INTO March,
  // since February has no 31st — a real pitfall this test avoids by
  // construction rather than by accident).
  const REF = new Date('2026-08-15T09:00:00.000Z');
  const monthsAgo = (n: number) => { const d = new Date(REF); d.setMonth(d.getMonth() - n); return d.toISOString(); };

  it('never suppressed when the entity was never declined', () => {
    expect(dormantDeclineSuppressed({ id: 'e1', dormant_decline_at: undefined }, [], REF)).toBe(false);
  });

  it('suppressed right after a decline, with no interaction since', () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(1) };
    expect(dormantDeclineSuppressed(e, [], REF)).toBe(true);
  });

  it('cleared by ANY real interaction logged after the decline, in or out, even inside the 6-month window', () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(2) };
    const inbound = { entity_id: 'e1', occurred_at: monthsAgo(1), channel: 'email' } as Pick<Interaction, 'entity_id' | 'occurred_at' | 'channel'>;
    expect(dormantDeclineSuppressed(e, [inbound], REF)).toBe(false);
  });

  it('ignores an interaction logged BEFORE the decline — that silence is what got declined', () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(1) };
    const before = { entity_id: 'e1', occurred_at: monthsAgo(2), channel: 'email' } as Pick<Interaction, 'entity_id' | 'occurred_at' | 'channel'>;
    expect(dormantDeclineSuppressed(e, [before], REF)).toBe(true);
  });

  it('ignores an interaction on a DIFFERENT entity', () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(1) };
    const other = { entity_id: 'e2', occurred_at: monthsAgo(0), channel: 'email' } as Pick<Interaction, 'entity_id' | 'occurred_at' | 'channel'>;
    expect(dormantDeclineSuppressed(e, [other], REF)).toBe(true);
  });

  // Caught live against real Supabase rows (see DECISIONS.md): Decline's
  // own logSystemNote writes an interactions row (channel='stage_change')
  // dated right at/after dormant_decline_at — without this exclusion it
  // would count as its own "new interaction" and self-clear immediately.
  it('a stage_change row (the decline\'s own system note) does NOT count as a clearing interaction', () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(1) };
    const ownNote = { entity_id: 'e1', occurred_at: monthsAgo(1), channel: 'stage_change' } as Pick<Interaction, 'entity_id' | 'occurred_at' | 'channel'>;
    expect(dormantDeclineSuppressed(e, [ownNote], REF)).toBe(true);
  });

  it(`the floor lifts on its own after ${DORMANT_DECLINE_SUPPRESS_MONTHS} months, even with zero interactions`, () => {
    const e = { id: 'e1', dormant_decline_at: monthsAgo(DORMANT_DECLINE_SUPPRESS_MONTHS) };
    expect(dormantDeclineSuppressed(e, [], REF)).toBe(false);
  });

  it('still suppressed one day short of the floor', () => {
    const d = new Date(REF); d.setMonth(d.getMonth() - DORMANT_DECLINE_SUPPRESS_MONTHS); d.setDate(d.getDate() + 1);
    const e = { id: 'e1', dormant_decline_at: d.toISOString() };
    expect(dormantDeclineSuppressed(e, [], REF)).toBe(true);
  });
});

describe('planAutomationRulesTick — Decline suppresses re-proposing (Prompt 883 §3)', () => {
  it('não propõe dormente de novo para uma entidade declinada há pouco, sem novo contacto', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1', dormant_decline_at: daysAgo(10) })],
        people: [person({ id: 'p1', entity_id: 'e1' })],
        interactions: [out('e1', 'p1', daysAgo(40)), out('e1', 'p1', daysAgo(20))],
      },
    }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.skipped.declinedRecently).toBe(1);
  });

  it('volta a propor assim que uma nova interação é registada depois do decline', () => {
    const plan = planAutomationRulesTick(input({
      db: {
        entities: [entity({ id: 'e1', dormant_decline_at: daysAgo(60) })],
        people: [person({ id: 'p1', entity_id: 'e1' })],
        // Segundo silêncio inteiramente DEPOIS do decline (daysAgo(60)).
        interactions: [out('e1', 'p1', daysAgo(40)), out('e1', 'p1', daysAgo(20))],
      },
    }));
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].source).toBe('automation_dormant');
    expect(plan.skipped.declinedRecently).toBe(0);
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
