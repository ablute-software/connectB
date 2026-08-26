import { describe, expect, it } from 'vitest';
import { entityMode, effectiveMode, nextBestAction, nextBestActionButton, nextContactPerson, nextPendingTaskDue, needsReopenTrigger } from './relationship';
import type { Db, Entity, Interaction, Person, TaskItem } from './types';

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

// Prompt 254 — minimal PASSING-preflight person by default: verified
// non-bounced email, researched hook, not do-not-contact, rank 1. Tests
// override only the field they're checking, so a failing check is always
// the ONE thing the test names, never an accidental side effect of an
// incomplete fixture.
function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1', entity_id: 'e1', full_name: 'Jane Doe', role: 'Partner', seniority_rank: 1,
    linkedin_verified: true, email_verified: 'jane@example.com', bounce_count: 0,
    hook_status: 'researched', kill_words: [], preferred_language: 'en',
    privacy_notice_sent: false, do_not_contact: false, identity_verified: false,
    linked_companies: [], linked_funds: [],
    ...over,
  } as Person;
}

function db(
  e: Entity, tasks: TaskItem[] = [], interactions: Interaction[] = [],
  reawakeningProposals: Db['reawakeningProposals'] = [], rejectionCodes: Db['rejectionCodes'] = [],
  people: Person[] = [],
): Db {
  return {
    entities: [e], interactions, people, tasks, relationshipState: [], reawakeningProposals, rejectionCodes,
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
  } as unknown as Db;
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
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Frozen — no revisit scheduled. No reopen trigger recorded — set one, or leave it frozen.');
  });

  it('dormant com revisit agendado: diz quando volta', () => {
    const e = entity({ status: 'dormant' });
    const t = task({ id: 't-rev', title: 'Revisit Test idividual', due_at: '2026-09-14T00:00:00.000Z' });
    expect(nextBestAction(db(e, [t]), 'e1', NOW)).toBe('Frozen — revisit on 2026-09-14. No reopen trigger recorded — set one, or leave it frozen.');
  });

  // Prompt 271 §4 — Fase 0: a stand_by/frozen_cold freeze (interacoes
  // reais, sem pass, sem reopen_trigger) deriva o facto real em vez do
  // texto generico "no reopen trigger recorded". Caso real ECS Capital:
  // inbound em fev/2024, zero follow-up — stand_by, recuperavel por nos.
  it('stand_by (inbound-last, caso real ECS Capital): "They spoke last... dropped thread"', () => {
    const e = entity({ status: 'dormant' });
    const its = [
      { id: 'i1', entity_id: 'e1', direction: 'in', channel: 'email', content: '...', occurred_at: '2024-02-10T00:00:00.000Z' },
      { id: 'i2', entity_id: 'e1', direction: 'in', channel: 'email', content: '...', occurred_at: '2024-02-27T00:00:00.000Z' },
    ] as Interaction[];
    expect(nextBestAction(db(e, [], its), 'e1', NOW))
      .toBe('They spoke last (2024-02-27) and never got a reply — this freeze looks like a dropped thread, not a closed door.');
  });

  // Prompt 273 — caso real Alter VP: 2 outbound nossos, zero respostas.
  // frozen_cold, NAO stand_by (correcao de um bug real do 271 original,
  // que dava o MESMO texto "dropped thread" para este caso — errado,
  // ninguem abandonou fio nenhum, eles e que nunca responderam).
  it('frozen_cold (outbound-last, caso real Alter VP): texto DIFERENTE de stand_by, nunca "dropped thread"', () => {
    const e = entity({ status: 'dormant' });
    const its = [
      { id: 'i1', entity_id: 'e1', direction: 'out', channel: 'email', content: '...', occurred_at: '2026-01-05T00:00:00.000Z' },
      { id: 'i2', entity_id: 'e1', direction: 'out', channel: 'email', content: '...', occurred_at: '2026-01-20T00:00:00.000Z' },
    ] as Interaction[];
    const result = nextBestAction(db(e, [], its), 'e1', NOW);
    expect(result).toBe('You reached out last (2026-01-20) and never heard back — reopening this needs a real new reason, same as a formal pass.');
    expect(result).not.toContain('dropped thread');
  });

  // Um pass MAIS ANTIGO que o ultimo inbound mantem effectiveMode em
  // 'parked' (le so o ultimo inbound — relationship.ts:579-583), mas
  // classifyFrozen ve QUALQUER pass alguma vez registado (mesmo criterio
  // da contagem real do Nuno, "3/34 tem um pass real registado") — por
  // isso o texto de dropped thread nao aparece, mesmo sem effectiveMode
  // ter mudado de branch.
  it('pass mais antigo que o ultimo inbound: closed_for_cause, nunca o texto de dropped thread', () => {
    const e = entity({ status: 'dormant' });
    const its = [
      { id: 'i1', entity_id: 'e1', direction: 'in', channel: 'email', content: '...', occurred_at: '2024-02-10T00:00:00.000Z', classification: 'pass' },
      { id: 'i2', entity_id: 'e1', direction: 'in', channel: 'email', content: '...', occurred_at: '2024-03-01T00:00:00.000Z', classification: 'question' },
    ] as Interaction[];
    const result = nextBestAction(db(e, [], its), 'e1', NOW);
    expect(result).not.toContain('dropped thread');
    expect(result).toBe('Frozen — no revisit scheduled. No reopen trigger recorded — set one, or leave it frozen.');
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

  it('not_contacted sem pessoa nenhuma: pede para adicionar um contacto', () => {
    const e = entity({ status: 'not_contacted' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Add a contact person first — pre-flight needs one to check.');
  });
});

// Prompt 254 — o Tip mostrava uma ORDEM ("run pre-flight") sem botao nem
// resultado. preflight() ja e puro e ja corre nesta mesma pagina (o
// painel People); nextBestAction() passa a correr e mostrar o RESULTADO.
describe('nextBestAction — not_contacted mostra o resultado do preflight (254)', () => {
  it('pessoa pronta: diz claro, cita o nome', () => {
    const e = entity({ status: 'not_contacted' });
    const p = person();
    expect(nextBestAction(db(e, [], [], [], [], [p]), 'e1', NOW)).toBe('Ready for first contact — pre-flight clear for Jane Doe.');
  });

  it('pessoa com falhas: conta as falhas, cita o nome, nao lista aqui (a lista e da UI)', () => {
    const e = entity({ status: 'not_contacted' });
    const p = person({ hook_status: 'to_research' });
    expect(nextBestAction(db(e, [], [], [], [], [p]), 'e1', NOW)).toBe('Not ready yet — pre-flight found 1 issue for Jane Doe:');
  });

  it('conta corretamente varias falhas', () => {
    const e = entity({ status: 'not_contacted' });
    const p = person({ hook_status: 'to_research', do_not_contact: true });
    // do_not_contact tambem bloqueia dnc — mas nextContactPerson ja filtra
    // do_not_contact fora da lista de candidatos, portanto este p NUNCA e
    // escolhido: sem ninguem contactavel, cai no caso "adicionar contacto".
    expect(nextBestAction(db(e, [], [], [], [], [p]), 'e1', NOW)).toBe('Add a contact person first — pre-flight needs one to check.');
  });

  it('escolhe o mais senior CONTACTAVEL, nao so o rank 1 literal', () => {
    const e = entity({ status: 'not_contacted' });
    const dnc = person({ id: 'p-dnc', seniority_rank: 1, do_not_contact: true });
    const junior = person({ id: 'p2', seniority_rank: 2, full_name: 'Junior Person' });
    // rank 2 nao tem senior nao-resolvido a bloquear (o rank 1 esta DNC,
    // logo nao conta como "senior por resolver" no preflight §5).
    expect(nextBestAction(db(e, [], [], [], [], [dnc, junior]), 'e1', NOW))
      .toBe('Ready for first contact — pre-flight clear for Junior Person.');
  });

  it('nextContactPerson devolve undefined sem pessoas, e o mais senior contactavel com varias', () => {
    const e = entity({ status: 'not_contacted' });
    expect(nextContactPerson(db(e), 'e1')).toBeUndefined();
    const senior = person({ id: 'p-senior', seniority_rank: 1 });
    const junior2 = person({ id: 'p-junior', seniority_rank: 2, full_name: 'Junior' });
    expect(nextContactPerson(db(e, [], [], [], [], [junior2, senior]), 'e1')?.id).toBe('p-senior');
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

  // Prompt 269 §2 — the Tip never splices the founder's raw reopen_trigger
  // text into its own sentence anymore (real case: "Reopens if: nothing
  // nee." read back a typo as if the app had said it). It now derives only
  // from structured fields; the raw note is rendered separately by
  // RelationshipSummaryCard's own "Your note when freezing" line.
  it('reopen_trigger preenchido, sem eligible_after: Tip generico, nunca cita o texto', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'ablute_ ships an actual paying customer' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Passed — reopens once your note (below) comes true.');
  });

  it('reopen_eligible_after ja passou: diz elegivel e a categoria, nunca cita o trigger', () => {
    const e = entity({
      status: 'passed', reopen_trigger: 'product live in market',
      reopen_eligible_after: '2026-08-01',
    });
    const pass = { id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', pass_reason_category: 'traction', occurred_at: '2026-06-01T10:00:00.000Z' } as Interaction;
    expect(nextBestAction(db(e, [], [pass]), 'e1', NOW))
      .toBe('Eligible for re-approach since 2026-08-01 — the earlier no was about traction.');
  });

  it('reopen_eligible_after no FUTURO: ainda nao elegivel, cai para o Tip generico', () => {
    const e = entity({ status: 'passed', reopen_trigger: 'DACH expansion', reopen_eligible_after: '2027-01-01' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Passed — reopens once your note (below) comes true.');
  });

  it('dormant com reopen_trigger: mesma logica, "stays frozen"', () => {
    const e = entity({ status: 'dormant', reopen_trigger: 'they raise a new fund' });
    expect(nextBestAction(db(e), 'e1', NOW)).toBe('Frozen — reopens once your note (below) comes true.');
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
  it('dormant + pass NAO diz "Frozen", diz que esta fechado', () => {
    const e = entity({ status: 'dormant' });
    const d = db(e, [], [{ id: 'p', entity_id: 'e1', direction: 'in', channel: 'email', content: '...',
      classification: 'pass', occurred_at: '2026-08-05T10:00:00.000Z' } as Interaction]) as Db;

    const acao = nextBestAction(d, 'e1', NOW);
    expect(acao).toBe('Passed 10 days ago. No reopen trigger recorded — set one, or leave it closed.');
    expect(acao).not.toContain('Frozen');
  });
});

// Prompt 396 §7 — the Sherlock Tip's advice gets an accompanying button
// when there's an obvious target. This sibling function covers the one
// NEW case (see relationship.ts's own comment on it for why it's separate
// from nextBestAction itself): overdue follow-up needs a resolved person.
describe('nextBestActionButton (396 §7)', () => {
  const oldOutbound = { id: 'i1', entity_id: 'e1', direction: 'out', channel: 'email', content: '...', occurred_at: '2026-07-01T10:00:00.000Z' } as Interaction;

  it('overdue com pessoa contactavel: follow_up com o id certo', () => {
    const e = entity({ status: 'contacted' });
    const p = person();
    expect(nextBestActionButton(db(e, [], [oldOutbound], [], [], [p]), 'e1', NOW)).toEqual({ kind: 'follow_up', personId: 'p1' });
  });

  it('overdue sem ninguem contactavel: undefined, nao inventa alvo', () => {
    const e = entity({ status: 'contacted' });
    expect(nextBestActionButton(db(e, [], [oldOutbound]), 'e1', NOW)).toBeUndefined();
  });

  it('not overdue (whoseTurn "them", dentro do lock): sem botao', () => {
    const e = entity({ status: 'contacted' });
    const recent = { ...oldOutbound, occurred_at: '2026-08-10T10:00:00.000Z' };
    const p = person();
    expect(nextBestActionButton(db(e, [], [recent], [], [], [p]), 'e1', NOW)).toBeUndefined();
  });

  it('parked/closed: sem botao, mesmo com um outbound antigo', () => {
    const e = entity({ status: 'dormant' });
    const p = person();
    expect(nextBestActionButton(db(e, [], [oldOutbound], [], [], [p]), 'e1', NOW)).toBeUndefined();
  });

  it('contact_lock activo: sem botao', () => {
    const e = entity({ status: 'contacted', contact_lock_until: '2026-08-20' });
    const p = person();
    expect(nextBestActionButton(db(e, [], [oldOutbound], [], [], [p]), 'e1', NOW)).toBeUndefined();
  });

  it('not_contacted: sem toque nenhum, sem botao', () => {
    const e = entity({ status: 'not_contacted' });
    const p = person();
    expect(nextBestActionButton(db(e, [], [], [], [], [p]), 'e1', NOW)).toBeUndefined();
  });
});
