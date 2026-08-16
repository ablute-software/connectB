import { describe, expect, it } from 'vitest';
import { softCircledThisRound, capitalExcluded, isLiveForCapital, LIVE_STATUSES } from './round-capital';
import type { Entity, EntityStatus } from './types';

// Prompt 212 §B.2 — os dados REAIS da ablute_ a 2026-08-16.
const REAIS = [
  { name: 'Nuno Marujo', status: 'not_contacted' as EntityStatus, interest_eur: 100_000 },
  { name: 'Adara Ventures', status: 'dormant' as EntityStatus, interest_eur: 300_000 },
] as Pick<Entity, 'name' | 'status' | 'interest_eur'>[];

describe('softCircledThisRound — o caso real', () => {
  it('a soma cega dava 400k contra um alvo de 300k; agora da 0', () => {
    expect(REAIS.reduce((s, e) => s + (e.interest_eur ?? 0), 0)).toBe(400_000); // o bug
    expect(softCircledThisRound(REAIS)).toBe(0);                                 // o fix
  });

  it('capital de quem RECUSOU nao conta', () => {
    expect(softCircledThisRound([{ status: 'dormant', interest_eur: 300_000 }] as Entity[])).toBe(0);
    expect(softCircledThisRound([{ status: 'passed', interest_eur: 50_000 }] as Entity[])).toBe(0);
  });

  it('capital de quem nunca foi contactado nao conta', () => {
    expect(softCircledThisRound([{ status: 'not_contacted', interest_eur: 100_000 }] as Entity[])).toBe(0);
  });

  it('conversa em curso conta', () => {
    expect(softCircledThisRound([
      { status: 'contacted', interest_eur: 10_000 },
      { status: 'in_conversation', interest_eur: 25_000 },
      { status: 'diligence', interest_eur: 50_000 },
    ] as Entity[])).toBe(85_000);
  });

  it('invested fica de fora -- ja nao e "soft", e outro numero', () => {
    expect(softCircledThisRound([{ status: 'invested', interest_eur: 200_000 }] as Entity[])).toBe(0);
  });

  it('sem interest_eur nao rebenta', () => {
    expect(softCircledThisRound([{ status: 'in_conversation' }] as Entity[])).toBe(0);
    expect(softCircledThisRound([])).toBe(0);
  });
});

describe('whitelist e nao blacklist', () => {
  // A emenda do Nuno: um status inventado no futuro tem de cair do lado
  // seguro sozinho, sem ninguem se lembrar de o acrescentar a uma lista de
  // exclusoes.
  it('um status desconhecido NAO entra na soma', () => {
    expect(isLiveForCapital('status_que_ainda_nao_existe' as EntityStatus)).toBe(false);
    expect(softCircledThisRound([{ status: 'futuro' as EntityStatus, interest_eur: 999 }] as Entity[])).toBe(0);
  });

  it('a lista viva e exactamente tres', () => {
    expect(LIVE_STATUSES).toEqual(['contacted', 'in_conversation', 'diligence']);
  });
});

describe('capitalExcluded — o numero nao muda sem explicacao', () => {
  it('diz o que ficou de fora, com nome e status', () => {
    expect(capitalExcluded(REAIS)).toEqual([
      { name: 'Nuno Marujo', status: 'not_contacted', amountEur: 100_000 },
      { name: 'Adara Ventures', status: 'dormant', amountEur: 300_000 },
    ]);
  });

  it('nao lista quem esta vivo nem quem nao tem valor', () => {
    expect(capitalExcluded([
      { name: 'Viva', status: 'in_conversation', interest_eur: 10_000 },
      { name: 'Sem valor', status: 'dormant', interest_eur: 0 },
      { name: 'Sem campo', status: 'passed' },
    ] as Pick<Entity, 'name' | 'status' | 'interest_eur'>[])).toEqual([]);
  });
});
