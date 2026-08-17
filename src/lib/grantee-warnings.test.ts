// Prompt 222 §2 — os avisos do picker de grantees. O que os testes fixam
// não é o texto por si: é que AVISAR nunca vira ESCONDER (nada aqui
// devolve uma lista filtrada de candidatos) e que a frase funciona sem
// data, que é o caso real de 3 das 31 entidades 'passed' da ablute_.
import { describe, expect, it } from 'vitest';
import { entityStatusChip, passedNote, doNotContactPeople, everyoneDncWarning } from './grantee-warnings';

describe('entityStatusChip', () => {
  it('passed é aviso; dormant e invested são informativos', () => {
    expect(entityStatusChip('passed')).toEqual({ label: 'passed', tone: 'warn' });
    expect(entityStatusChip('dormant')).toEqual({ label: 'dormant', tone: 'muted' });
    expect(entityStatusChip('invested')).toEqual({ label: 'invested', tone: 'muted' });
  });

  it('os estados normais não geram chip — o aviso tem de ser sinal, não ruído', () => {
    expect(entityStatusChip('not_contacted')).toBeNull();
    expect(entityStatusChip('contacted')).toBeNull();
    expect(entityStatusChip('in_conversation')).toBeNull();
  });
});

describe('passedNote', () => {
  it('com data: mês e ano por extenso', () => {
    expect(passedNote('Adara Ventures', '2026-08-05T10:00:00Z'))
      .toBe('Adara Ventures passed in August 2026 — are you sure?');
  });

  it('SEM data ainda avisa — o caso real de 3 entidades passed sem interação de pass', () => {
    expect(passedNote('Explorer Investments', null))
      .toBe('Explorer Investments is marked as passed — are you sure?');
    expect(passedNote('Explorer Investments')).toContain('marked as passed');
  });

  it('nunca devolve "Invalid Date"', () => {
    expect(passedNote('X', null)).not.toContain('Invalid');
  });
});

describe('do_not_contact', () => {
  const people = [
    { id: 'p1', full_name: 'Ana Silva', do_not_contact: true },
    { id: 'p2', full_name: 'Rui Costa' },
    { id: 'p3', full_name: 'Marta Lopes', do_not_contact: true },
  ];

  it('identifica os marcados sem os REMOVER de nada', () => {
    expect(doNotContactPeople(people).map((p) => p.id)).toEqual(['p1', 'p3']);
    // a lista original fica intacta — avisar não é filtrar
    expect(people).toHaveLength(3);
  });

  it('o aviso do "Everyone" nomeia quem entra, e diz que entra', () => {
    const warning = everyoneDncWarning(people);
    expect(warning).toContain('Ana Silva');
    expect(warning).toContain('Marta Lopes');
    expect(warning).toContain('they will get in');
  });

  it('singular vs plural', () => {
    expect(everyoneDncWarning([people[0]])).toContain('is marked do-not-contact');
    expect(everyoneDncWarning(people)).toContain('are marked do-not-contact');
  });

  it('sem ninguém marcado, não há aviso (hoje: 0 na ablute_)', () => {
    expect(everyoneDncWarning([{ id: 'p2', full_name: 'Rui Costa' }])).toBeNull();
    expect(everyoneDncWarning([])).toBeNull();
  });
});
