// Prompt 219 bloco 2 (Prompt 221) — um teste por regra, no mínimo, e os
// átomos REAIS da ablute_ do bloco 1 (prémio, visita sem nome, equipa
// só-Carla) a disparar exatamente o que o 219 diz que disparam.
import { describe, expect, it } from 'vitest';
import {
  detectGaps, ruleG1, ruleG2, ruleG3, ruleG3b, ruleG3c, ruleG4, ruleG5, ruleG6, ruleG7,
  templateFor, QUESTION_TEMPLATES, type GapContext,
} from './company-gaps';
import { normalizeAtom } from './company-claims';
import type { CompanyClaim, ClaimCategory, ClaimSourceKind, ClaimStatus } from './types';

const NOW = new Date('2026-08-17T12:00:00Z');

// Constrói o claim persistido a partir do MESMO normalizeAtom do bloco 1 —
// os testes usam a classificação real, nunca valores escritos à mão.
function claim(
  id: string, category: ClaimCategory, statement: string,
  over: { sourceKind?: ClaimSourceKind; status?: ClaimStatus; updatedAt?: string } = {},
): CompanyClaim {
  const sourceKind = over.sourceKind ?? 'fact';
  const n = normalizeAtom({ category, statement, sourceKind });
  return {
    id, category, statement, sourceKind,
    evidenceClass: n.evidenceClass, specificity: n.specificity,
    status: over.status ?? 'accepted', updatedAt: over.updatedAt ?? '2026-08-01T00:00:00Z',
  };
}

// Os três átomos reais da ablute_ (bloco 1).
const PREMIO = claim('c-premio', 'equipa', 'Carla Dias won the WomenTechEU prize, €75,000 non-dilutive, 2022', { sourceKind: 'roadmap' });
const VISITA_VAGA = claim('c-visita', 'validacao_externa', "the world's manufacturing leader sent a committee to visit us for a week");
const VISITA_RESPONDIDA = claim('c-visita2', 'validacao_externa', 'Acme Corp sent a committee to Portugal for a week in 2026 and we are negotiating a pilot LOI', { sourceKind: 'founder_answer' });

function ctx(over: Partial<GapContext> = {}): GapContext {
  return { founders: [], now: NOW, ...over };
}

describe('G1 — tração sem compromisso pago', () => {
  it('dispara quando não há NENHUM claim de classe 1 em tracao_gtm', () => {
    const gaps = ruleG1([claim('t1', 'tracao_gtm', 'three hospitals expressed interest in the product')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G1', severity: 'critical' });
    expect(gaps[0].relatedClaimIds).toEqual(['t1']);
  });

  it('ausência TOTAL de tração também dispara — não é isenção', () => {
    expect(ruleG1([PREMIO]).map((g) => g.rule)).toEqual(['G1']);
  });

  it('não dispara com um cliente pagante', () => {
    expect(ruleG1([claim('t2', 'tracao_gtm', 'paid pilot with Hospital de Braga, invoiced €12,000')])).toEqual([]);
  });
});

describe('G2 — classe forte desperdiçada (reutiliza isWastedStrongClaim)', () => {
  it('a visita VAGA dispara — o caso canónico do 219', () => {
    const gaps = ruleG2([VISITA_VAGA]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G2', severity: 'high', relatedClaimIds: ['c-visita'] });
  });

  it('a mesma visita respondida já não dispara; o prémio (classe 5) nunca dispara', () => {
    expect(ruleG2([VISITA_RESPONDIDA, PREMIO])).toEqual([]);
  });
});

describe('G3 — narrativa de equipa', () => {
  it('equipa só-Carla dispara: <2 nomeados e sem complementaridade', () => {
    const gaps = ruleG3([PREMIO]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].rule).toBe('G3');
    expect(gaps[0].message).toContain('only 1 named person');
    expect(gaps[0].message).toContain('why THIS team wins');
  });

  it('dois nomes + complementaridade não dispara', () => {
    expect(ruleG3([
      claim('e1', 'equipa', 'Carla Dias led clinical operations at Hospital de Braga for six years'),
      claim('e2', 'equipa', 'Rui Almeida and Carla Dias combine hardware engineering with clinical practice'),
    ])).toEqual([]);
  });
});

describe('G3b — assimetria por NOME (219-B)', () => {
  it('um founder com narrativa e outros dois sem: uma lacuna POR NOME', () => {
    const gaps = ruleG3b([PREMIO], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }, { name: 'Nuno Marujo' }] }));
    expect(gaps.map((g) => g.meta?.founderName)).toEqual(['Rui Almeida', 'Nuno Marujo']);
    expect(gaps[0].meta?.coveredNames).toBe('Carla Dias');
  });

  it('nenhum founder coberto é G3 (ausência), não assimetria', () => {
    expect(ruleG3b([claim('e1', 'equipa', 'the founding team has deep clinical experience')],
      ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }))).toEqual([]);
  });

  it('todos cobertos não dispara', () => {
    expect(ruleG3b(
      [PREMIO, claim('e2', 'equipa', 'Rui Almeida built the first hardware prototype')],
      ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }),
    )).toEqual([]);
  });
});

describe('G3c — funções críticas sem dono (219-B)', () => {
  it('sem ninguém nomeado na parte técnica, dispara — mesmo com equipa nomeada noutra coisa', () => {
    const gaps = ruleG3c([PREMIO], ctx());
    expect(gaps.map((g) => g.meta?.functionKey)).toEqual(['technical']);
  });

  it('em seed, a função financeira também é exigida', () => {
    const gaps = ruleG3c([claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')], ctx({ stage: 'seed' }));
    expect(gaps.map((g) => g.meta?.functionKey)).toEqual(['financial']);
  });

  it('técnica com dono nomeado, fora de seed: nada dispara', () => {
    expect(ruleG3c([claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')], ctx({ stage: 'pre-seed' }))).toEqual([]);
  });

  it('pre-seed NÃO é seed — quem ainda não tem ronda para gerir não precisa de dono financeiro', () => {
    const withCto = [claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')];
    expect(ruleG3c(withCto, ctx({ stage: 'pre-seed' }))).toEqual([]);
    expect(ruleG3c(withCto, ctx({ stage: 'Pre Seed' }))).toEqual([]);
    expect(ruleG3c(withCto, ctx({ stage: 'seed' })).map((g) => g.meta?.functionKey)).toEqual(['financial']);
    expect(ruleG3c(withCto, ctx({ stage: 'Series A' })).map((g) => g.meta?.functionKey)).toEqual(['financial']);
  });
});

describe('G4 — claim aceite sem documento no Vault', () => {
  it('dispara para o aceite sem vault_doc na sua categoria', () => {
    const gaps = ruleG4([VISITA_VAGA]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G4', relatedClaimIds: ['c-visita'] });
  });

  it('um vault_doc na mesma categoria cobre os restantes', () => {
    expect(ruleG4([VISITA_VAGA, claim('v1', 'validacao_externa', 'Committee visit report, March 2026', { sourceKind: 'vault_doc' })])).toEqual([]);
  });

  it('claims propostos (ainda não aceites) não são lacuna documental', () => {
    expect(ruleG4([claim('p1', 'solucao', 'the device sanitises in 90 seconds', { status: 'proposed' })])).toEqual([]);
  });
});

describe('G5 — staleness', () => {
  it('além dos 6 meses (default) dispara', () => {
    const gaps = ruleG5([claim('s1', 'solucao', 'the device is in clinical testing', { updatedAt: '2025-06-01T00:00:00Z' })], ctx());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('6 months');
  });

  it('o limite é parametrizável', () => {
    const stale = claim('s1', 'solucao', 'the device is in clinical testing', { updatedAt: '2026-06-01T00:00:00Z' });
    expect(ruleG5([stale], ctx())).toEqual([]);
    expect(ruleG5([stale], ctx({ staleMonths: 1 }))).toHaveLength(1);
  });
});

describe('G6 — mecanismo da ronda', () => {
  it('funding/ask sem uso-de-fundos nem porquê-agora dispara com ambos em falta', () => {
    const gaps = ruleG6([claim('f1', 'ask', 'we are raising €1.3M')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].meta?.missing).toBe('use of funds, why now');
  });

  it('o porquê-agora pode viver em mercado_timing', () => {
    const gaps = ruleG6([
      claim('f1', 'ask', 'we are raising €1.3M to hire two engineers and finish certification'),
      claim('m1', 'mercado_timing', 'new EU hygiene regulation takes effect in 2027 — the window is now'),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe('G7 — claim central isolado (Prompt 299 §2)', () => {
  it('dispara quando forte+específico e sem nome extraível — confiança high', () => {
    const gaps = ruleG7([claim('c-iso1', 'solucao', 'In 2026, we signed a contract worth €50,000 for the pilot deployment')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G7', severity: 'high', detectionConfidence: 'high', relatedClaimIds: ['c-iso1'] });
  });

  it('dispara quando forte+específico com nome extraível e sem corroboração — confiança low, severity reduzida', () => {
    const gaps = ruleG7([VISITA_RESPONDIDA]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G7', severity: 'medium', detectionConfidence: 'low' });
  });

  it('não dispara quando há outro claim aceite na MESMA categoria (nível 1)', () => {
    const gaps = ruleG7([
      VISITA_RESPONDIDA,
      claim('c-other', 'validacao_externa', 'Beta Ltd signed a paid pilot with us in 2026, contract worth €20,000'),
    ]);
    expect(gaps).toEqual([]);
  });

  it('não dispara quando o MESMO NOME aparece noutro claim aceite (nível 2)', () => {
    const gaps = ruleG7([
      VISITA_RESPONDIDA,
      claim('c-other', 'equipa', 'Acme Corp introduced us to their CTO, who now advises our team since 2026'),
    ]);
    expect(gaps).toEqual([]);
  });

  it('não dispara sobre claims propostos (só claims aceites contam)', () => {
    expect(ruleG7([{ ...VISITA_RESPONDIDA, status: 'proposed' }])).toEqual([]);
  });

  it('não dispara sobre classe 4/5 fora de problema/solucao — mecanismo/decoração não pretendem ser "a" alegação central', () => {
    expect(ruleG7([PREMIO])).toEqual([]); // PREMIO é classe 5 (decoração)
    expect(ruleG7([claim('c-mkt', 'mercado_timing', 'the EU regulation window opens in Q1 2027 for certified devices')])).toEqual([]);
  });
});

describe('detectGaps — agregação', () => {
  it('a ablute_ de hoje (prémio + visita vaga) dispara exatamente o esperado', () => {
    const gaps = detectGaps([PREMIO, VISITA_VAGA], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }));
    const rules = gaps.map((g) => g.rule);
    expect(rules).toContain('G1');   // nenhuma tração paga
    expect(rules).toContain('G2');   // a visita vaga
    expect(rules).toContain('G3');   // equipa só-Carla
    expect(rules).toContain('G3b');  // Rui sem narrativa
    expect(rules).toContain('G3c');  // ninguém lidera a técnica
    expect(rules).toContain('G4');   // sem documento de suporte
    expect(rules).toContain('G6');   // sem uso de fundos / porquê agora
    expect(rules).not.toContain('G5'); // atualizado há duas semanas
  });

  it('não lança com input vazio', () => {
    expect(() => detectGaps([], ctx())).not.toThrow();
    expect(detectGaps([], ctx()).map((g) => g.rule).sort()).toEqual(['G1', 'G3', 'G3c', 'G6']);
  });
});

describe('templateFor — os templates são dados, preenchidos por meta', () => {
  it('há exatamente uma template por regra', () => {
    expect(QUESTION_TEMPLATES.map((t) => t.rule).sort()).toEqual(['G1', 'G2', 'G3', 'G3b', 'G3c', 'G4', 'G5', 'G6', 'G7']);
  });

  it('G2 injeta o statement do claim vago', () => {
    const t = templateFor(ruleG2([VISITA_VAGA])[0]);
    expect(t.question).toContain("the world's manufacturing leader");
    expect(t.question).not.toContain('{statement}');
    expect(t.freeTextLabel).toBe('Name + date + outcome');
  });

  it('G3b injeta o nome descoberto e quem já está coberto', () => {
    const gap = ruleG3b([PREMIO], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }))[0];
    const t = templateFor(gap);
    expect(t.question).toContain('Rui Almeida');
    expect(t.question).toContain('Carla Dias');
    expect(t.options).toContain('Full-time');
  });

  it('G3c oferece "No one yet" — a ausência é para reportar, não esconder', () => {
    const t = templateFor(ruleG3c([PREMIO], ctx())[0]);
    expect(t.question).toBe('Who leads the technical side?');
    expect(t.options).toContain('No one yet');
  });
});
