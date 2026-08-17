import { describe, expect, it } from 'vitest';
import {
  classifyEvidence, measureSpecificity, normalizeAtom, isWastedStrongClaim, rankForNarrative,
  type RawAtom,
} from './company-claims';

// Prompt 219 bloco 1 — os átomos REAIS da ablute_, do próprio prompt. O
// antes/depois do 1.5 depende de esta classificação sair exactamente assim.

const PREMIO: RawAtom = {
  category: 'equipa',
  statement: 'Carla Dias won the WomenTechEU prize, €75,000 non-dilutive, 2022',
  sourceKind: 'roadmap',
};

const VISITA_VAGA: RawAtom = {
  category: 'validacao_externa',
  statement: "the world's manufacturing leader sent a committee to visit us for a week",
  sourceKind: 'fact',
};

const VISITA_RESPONDIDA: RawAtom = {
  category: 'validacao_externa',
  statement: 'Acme Corp sent a committee to Portugal for a week in 2026 and we are negotiating a pilot LOI',
  sourceKind: 'founder_answer',
};

describe('classifyEvidence — a hierarquia acordada', () => {
  it('o prémio é classe 5 MESMO estando na categoria equipa — decoração sobrepõe-se', () => {
    expect(classifyEvidence(PREMIO.category, PREMIO.statement)).toBe(5);
  });

  it('a visita é classe 2 — validação externa custosa', () => {
    expect(classifyEvidence(VISITA_VAGA.category, VISITA_VAGA.statement)).toBe(2);
  });

  it('tração SEM dinheiro não é classe 1 — é intenção, cai para 2', () => {
    expect(classifyEvidence('tracao_gtm', 'three hospitals expressed interest in the product')).toBe(2);
  });

  it('tração COM dinheiro é classe 1', () => {
    expect(classifyEvidence('tracao_gtm', 'first paying customer signed a contract in Q2')).toBe(1);
    expect(classifyEvidence('tracao_gtm', 'paid pilot with Hospital de Braga, invoiced €12,000')).toBe(1);
  });

  it('equipa sem decoração é classe 3', () => {
    expect(classifyEvidence('equipa', 'founding team pairs clinical expertise with hardware engineering')).toBe(3);
  });

  it('mecanismo é classe 4', () => {
    expect(classifyEvidence('problema', 'care homes have no continuous hygiene monitoring at night')).toBe(4);
  });
});

describe('measureSpecificity — medida, não opinião', () => {
  it('a visita VAGA é baixa: sem nome, sem data, sem outcome', () => {
    const { level, signals } = measureSpecificity(VISITA_VAGA.statement);
    expect(level).toBe('low');
    expect(signals.hasNamedEntity).toBe(false);
    expect(signals.hasOutcome).toBe(false);
  });

  it('a mesma visita RESPONDIDA é alta: nome + data + outcome', () => {
    const { level, signals } = measureSpecificity(VISITA_RESPONDIDA.statement);
    expect(level).toBe('high');
    expect(signals.hasNamedEntity).toBe(true);
    expect(signals.hasOutcome).toBe(true);
  });

  it('o prémio é alto: nome, número e ano', () => {
    expect(measureSpecificity(PREMIO.statement).level).toBe('high');
  });
});

describe('isWastedStrongClaim — o delta que dispara a pergunta (G2)', () => {
  it('a visita vaga É o caso: classe 2, especificidade baixa', () => {
    expect(isWastedStrongClaim(normalizeAtom(VISITA_VAGA))).toBe(true);
  });

  it('depois de respondida deixa de ser', () => {
    expect(isWastedStrongClaim(normalizeAtom(VISITA_RESPONDIDA))).toBe(false);
  });

  it('o prémio nunca dispara — classe 5 vaga não vale a pergunta', () => {
    expect(isWastedStrongClaim(normalizeAtom(PREMIO))).toBe(false);
  });
});

describe('rankForNarrative — a ordem que o pitch deve seguir', () => {
  it('a visita respondida vem À FRENTE do prémio, sempre', () => {
    const ranked = rankForNarrative([normalizeAtom(PREMIO), normalizeAtom(VISITA_RESPONDIDA)]);
    expect(ranked[0].statement).toContain('Acme');
    expect(ranked[1].statement).toContain('WomenTechEU');
  });

  it('dentro da mesma classe, o mais específico primeiro', () => {
    const ranked = rankForNarrative([normalizeAtom(VISITA_VAGA), normalizeAtom(VISITA_RESPONDIDA)]);
    expect(ranked[0].specificity).toBe('high');
  });

  it('não muta a lista de entrada', () => {
    const input = [normalizeAtom(PREMIO), normalizeAtom(VISITA_RESPONDIDA)];
    const before = input.map((c) => c.statement);
    rankForNarrative(input);
    expect(input.map((c) => c.statement)).toEqual(before);
  });
});
