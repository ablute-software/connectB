// Prompt 219 bloco 3 §1 (Prompt 223) — o mapper da ingestão.
//
// Os casos são os átomos REAIS da ablute_, agora com o texto exacto que
// está em `company_facts` na produção (lido por SQL antes de escrever isto,
// gralha "commitive" incluída) — não a versão limpa que os blocos 1 e 2
// usaram à mão. É esse o ponto do teste: provar que a cadeia
// linha real → RawAtom → normalizeAtom → detectGaps chega às mesmas
// conclusões sobre a empresa de verdade.
import { describe, expect, it } from 'vitest';
import {
  factToAtom, orgProfileToAtoms, fundingRoundToAtom, roadmapToAtoms,
  personToAtom, clarificationToAtom, knowledgeToAtoms,
  isAlreadyKnown, newAtoms, type KnowledgeSources,
} from './company-knowledge';
import { normalizeAtom } from './company-claims';
import { detectGaps } from './company-gaps';

// As três linhas confirmadas de company_facts da ablute_, verbatim.
const FACT_PREMIO = { id: 'f1', category: 'team' as const, status: 'confirmed', statement: 'Carla Dias is a WomenInTech EU awardee' };
const FACT_VISITA = { id: 'f2', category: 'traction' as const, status: 'confirmed', statement: "The world's manufacturing leader sent an commitive to visit us in Portugal for one week" };
const FACT_PILOTO = { id: 'f3', category: 'other' as const, status: 'confirmed', statement: 'Pilot is planned but protocol not yet locked' };

describe('factToAtom', () => {
  it('só ingere factos CONFIRMADOS — por confirmar ainda não é conhecimento', () => {
    expect(factToAtom({ ...FACT_PREMIO, status: 'unconfirmed' })).toBeNull();
    expect(factToAtom({ ...FACT_PREMIO, status: 'deprecated' })).toBeNull();
    expect(factToAtom(FACT_PREMIO)).not.toBeNull();
  });

  it('mapeia a categoria do founder fielmente, e guarda a origem', () => {
    expect(factToAtom(FACT_PREMIO)).toMatchObject({ category: 'equipa', sourceKind: 'fact', sourceRef: 'f1' });
    expect(factToAtom(FACT_VISITA)).toMatchObject({ category: 'tracao_gtm' });
    expect(factToAtom(FACT_PILOTO)).toMatchObject({ category: 'solucao' });
  });

  it('o prémio real continua a ser classe 5 — decoração sobrepõe-se ao rótulo "team"', () => {
    expect(normalizeAtom(factToAtom(FACT_PREMIO)!).evidenceClass).toBe(5);
  });

  it('a visita real, gravada como "traction", é corrigida para classe 2 pelo classificador', () => {
    // O founder rotulou-a de tração; não há dinheiro na frase, portanto o
    // bloco 1 baixa-a sozinho. O rótulo fica, a força não.
    const claim = normalizeAtom(factToAtom(FACT_VISITA)!);
    expect(claim.evidenceClass).toBe(2);
    expect(claim.specificity).toBe('low');
  });

  it('ambiguidade mapeia para a categoria MAIS FRACA — regulatory nunca finge validação externa', () => {
    const atom = factToAtom({ id: 'f9', category: 'regulatory', status: 'confirmed', statement: 'CE marking still required before sale' })!;
    expect(atom.category).toBe('prova_tecnica');
    expect(normalizeAtom(atom).evidenceClass).toBe(4); // 4, não 2
  });
});

describe('orgProfileToAtoms — a regra raiz na prática', () => {
  const org = {
    one_liner: 'Continuous hygiene monitoring for care homes',
    sectors: ['healthtech'], country: 'Portugal', stage: 'seed', founded_year: 2021,
    round_target_eur: 1_300_000, round_use_of_funds: 'Two engineers and CE certification',
  };

  it('o ASK entra — o pedido é o pitch', () => {
    const ask = orgProfileToAtoms(org).find((a) => a.category === 'ask');
    expect(ask?.statement).toContain('€1.3M');
  });

  it('o PROGRESSO contra o ask NUNCA entra, mesmo estando na mesma linha da org', () => {
    const atoms = orgProfileToAtoms({ ...org, round_secured_eur: 100_000 } as never);
    const all = atoms.map((a) => a.statement).join(' | ');
    expect(all).not.toContain('100');
    expect(all.toLowerCase()).not.toContain('secured');
  });

  it('uso de fundos vira claim de funding — é o que o G6 procura', () => {
    const gaps = detectGaps(
      orgProfileToAtoms(org).map((a, i) => ({
        id: `o${i}`, ...normalizeAtom(a), sourceKind: a.sourceKind, status: 'accepted' as const,
      })),
      { founders: [], now: new Date('2026-08-17') },
    );
    expect(gaps.find((g) => g.rule === 'G6')?.meta?.missing).toBe('why now');
  });
});

describe('as outras fontes', () => {
  it('funding_round leva montante e ano — e fica MEDIUM sem investidor nomeado', () => {
    const atom = fundingRoundToAtom({ id: 'r1', label: 'Pre-seed', amount_eur: 100_000, closed_year: 2023 })!;
    expect(atom.statement).toBe('Pre-seed of €100k closed in 2023.');
    // Escrevi 'high' à primeira e o teste corrigiu-me: há número e ano, mas
    // não há NOME (quem investiu) — e 'closed' não está no vocabulário de
    // desfecho do bloco 1. Medium é a leitura certa, e é útil: uma ronda
    // anterior sem investidor nomeado é mesmo menos verificável, e é isso
    // que faz a app perguntar em vez de escrever a frase como se bastasse.
    expect(normalizeAtom(atom).specificity).toBe('medium');
  });

  it('a mesma ronda COM investidor nomeado sobe a high', () => {
    const atom = fundingRoundToAtom({ id: 'r2', label: 'Pre-seed', amount_eur: 100_000, closed_year: 2023, note: 'Led by Shilling Capital.' })!;
    expect(normalizeAtom(atom).specificity).toBe('high');
  });

  it('roadmap gera um claim por ITEM, com o período e a categoria do founder', () => {
    const atoms = roadmapToAtoms(
      [{ id: 'm1', period_kind: 'quarter', period_year: 2026, period_quarter: 2, items: [], items_v2: [
        { text: 'Close first paid pilot', category_id: 'c1' },
        { text: 'Hire hardware engineer', category_id: null },
      ] }],
      [{ id: 'c1', label: 'Commercial' }],
    );
    expect(atoms[0].statement).toBe('Q2 2026 — Close first paid pilot (Commercial)');
    // sem categoria não escreve "(General)" — seria ruído em todo o lado
    expect(atoms[1].statement).toBe('Q2 2026 — Hire hardware engineer');
  });

  it('pessoa leva nome e cargo — o que o G3/G3c procuram', () => {
    const atom = personToAtom({ id: 'p1', full_name: 'Rui Almeida', title: 'CTO', is_founder: true })!;
    expect(atom.statement).toBe('Rui Almeida, CTO (founder).');
    expect(atom.category).toBe('equipa');
  });

  it('esclarecimento entra como founder_answer', () => {
    expect(clarificationToAtom({ id: 'cl1', category: 'weaknesses', item_text: 'x', clarification_text: 'We signed the protocol in July.' }))
      .toMatchObject({ sourceKind: 'founder_answer', category: 'solucao' });
  });
});

describe('knowledgeToAtoms + dedup', () => {
  const sources: KnowledgeSources = {
    facts: [FACT_PREMIO, FACT_VISITA, FACT_PILOTO, { ...FACT_PREMIO, id: 'f4', status: 'unconfirmed' }],
    org: null, fundingRounds: [], milestones: [], roadmapCategories: [], people: [], clarifications: [],
  };

  it('agrega e deixa cair os não-confirmados', () => {
    expect(knowledgeToAtoms(sources)).toHaveLength(3);
  });

  it('a ablute_ real dispara as mesmas lacunas dos blocos 1/2', () => {
    const claims = knowledgeToAtoms(sources).map((a, i) => ({
      id: `c${i}`, ...normalizeAtom(a), sourceKind: a.sourceKind, status: 'accepted' as const,
    }));
    const rules = detectGaps(claims, { founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }], now: new Date('2026-08-17') }).map((g) => g.rule);
    expect(rules).toContain('G1');   // nenhuma tração paga
    expect(rules).toContain('G2');   // a visita vaga, vinda da tabela a sério
    expect(rules).toContain('G3');   // equipa só-Carla
    expect(rules).toContain('G3b');  // Rui sem narrativa
    expect(rules).toContain('G6');   // sem uso de fundos / porquê agora
  });

  it('não re-propõe o que já foi aceite NEM o que já foi rejeitado', () => {
    const atoms = knowledgeToAtoms(sources);
    const existing = [
      { statement: 'Carla Dias is a WomenInTech EU awardee', status: 'accepted' },
      { statement: 'pilot is planned but protocol NOT yet locked', status: 'rejected' },
    ];
    expect(isAlreadyKnown(atoms[0], existing)).toBe(true);
    // rejeitado conta, e a comparação ignora caixa e espaços
    expect(newAtoms(atoms, existing).map((a) => a.sourceRef)).toEqual(['f2']);
  });

  // Prompt 366 — inverte o teste anterior, que encodava o próprio bug: um
  // claim ainda `proposed` com o MESMO texto TEM de impedir reinserção — sem
  // isto, cada "Re-read my company" sobre um perfil inalterado duplicava a
  // fila "To review" byte a byte, sempre que POST /api/blueprint corria de
  // novo (o seu próprio comentário já dizia "não duplica", o código fazia o
  // oposto até este fix).
  it('um claim ainda "proposed" com o MESMO texto impede reinserção — o bug real do 366', () => {
    const atoms = knowledgeToAtoms(sources);
    expect(isAlreadyKnown(atoms[0], [{ statement: atoms[0].statement, status: 'proposed' }])).toBe(true);
  });

  it('newAtoms nunca duplica um proposed já existente numa segunda chamada (fixture de regressão)', () => {
    const atoms = knowledgeToAtoms(sources);
    const alreadyProposed = atoms.map((a) => ({ statement: a.statement, status: 'proposed' }));
    expect(newAtoms(atoms, alreadyProposed)).toEqual([]);
  });
});
