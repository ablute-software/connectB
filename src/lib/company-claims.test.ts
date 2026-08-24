import { describe, expect, it } from 'vitest';
import {
  classifyEvidence, measureSpecificity, normalizeAtom, isWastedStrongClaim, rankForNarrative, weakClaimCoachingNote,
  extractNamedEntity, findDuplicateCandidate, findDocumentLinkCandidate, proposeClaimFromDocumentFact, strengthenGaps,
  joinChipAndFreeText, type RawAtom,
} from './company-claims';
import type { CompanyClaim } from './types';

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

// Prompt 307 §B2 — o "NDA signed, no further negotiations" do Nuno é
// exactamente a forma de VISITA_VAGA: outcome presente, sem nome, sem data —
// a mesma baixa especificidade que já existia, agora com uma ilação.
describe('weakClaimCoachingNote — a ilação para o founder, nunca para o investidor', () => {
  it('dispara para especificidade baixa', () => {
    const note = weakClaimCoachingNote(normalizeAtom(VISITA_VAGA));
    expect(note).not.toBeNull();
    expect(note).toContain('external validation');
  });

  it('não dispara para especificidade alta', () => {
    expect(weakClaimCoachingNote(normalizeAtom(VISITA_RESPONDIDA))).toBeNull();
  });

  it('não dispara para especificidade média', () => {
    // 2 sinais (nome + numero, sem data nem outcome) = média.
    const claim = normalizeAtom({ category: 'tracao_gtm', statement: 'Hospital de Braga mentioned interest in 3 units', sourceKind: 'fact' });
    expect(claim.specificity).toBe('medium');
    expect(weakClaimCoachingNote(claim)).toBeNull();
  });

  it('nunca menciona investidores, pipeline, ou linguagem de fundraising', () => {
    const note = weakClaimCoachingNote(normalizeAtom(VISITA_VAGA))!;
    expect(note.toLowerCase()).not.toMatch(/investor|pipeline|pass|contacted/);
  });

  it('nomeia a categoria certa em cada caso', () => {
    expect(weakClaimCoachingNote(normalizeAtom({ category: 'equipa', statement: 'a strong team', sourceKind: 'fact' }))).toContain('team');
    expect(weakClaimCoachingNote(normalizeAtom({ category: 'funding', statement: 'talking to investors', sourceKind: 'fact' }))).toContain('funding');
  });
});

describe('extractNamedEntity — o mesmo sinal do hasNamedEntity, mas devolvendo o texto', () => {
  it('extrai o mesmo nome que measureSpecificity já detecta como presente', () => {
    // (?!^) (herdado, não novo aqui) bloqueia um match a começar na própria
    // posição 0 — um nome que abre a frase só é capturado a partir da
    // segunda palavra. "Dias" continua a ser uma chave de comparação válida.
    expect(extractNamedEntity(PREMIO.statement)).toBe('Dias');
    expect(measureSpecificity(PREMIO.statement).signals.hasNamedEntity).toBe(true);
  });

  it('extrai o nome completo quando não é a primeira palavra da frase', () => {
    expect(extractNamedEntity('The award went to Carla Dias in 2022')).toBe('Carla Dias');
  });

  it('devolve null quando não há nome próprio a meio da frase', () => {
    expect(extractNamedEntity(VISITA_VAGA.statement)).toBeNull();
  });
});

// Prompt 311 §C — o caso real da Carla Dias/WomenTechEU: a MESMA coisa,
// 4 claims nunca ligados, em categorias diferentes.
function claim(id: string, over: Partial<CompanyClaim> = {}): Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'> {
  return { id, statement: 'placeholder', status: 'proposed', evidenceClass: 4, ...over };
}

describe('findDuplicateCandidate (Prompt 311 §C) — o sinal estreito, não dedup geral', () => {
  const CARLA_FACT = claim('c-fact', { statement: 'Carla Dias is a WomenInTech EU awardee', evidenceClass: 5, status: 'proposed' });
  const CARLA_PROFILE = claim('c-profile', { statement: 'Carla Dias, CTO. Woman In Tech EU warded', evidenceClass: 5, status: 'accepted' });
  const CARLA_ROADMAP = claim('c-roadmap', { statement: '2022 — WomenTechEU prize', evidenceClass: 5, status: 'accepted' });

  it('marca um novo claim classe-5 como possível duplicado de um existente que nomeia a MESMA pessoa, mesmo noutra categoria', () => {
    const match = findDuplicateCandidate(CARLA_FACT, [CARLA_PROFILE, CARLA_ROADMAP]);
    expect(match).toEqual({ id: 'c-profile', statement: CARLA_PROFILE.statement });
  });

  it('nunca dispara para um claim que não é classe 5 (decoração), mesmo partilhando o nome', () => {
    const named = claim('c-other', { statement: 'Carla Dias leads the technical side.', evidenceClass: 3 });
    expect(findDuplicateCandidate(named, [CARLA_PROFILE])).toBeNull();
  });

  it('nunca dispara contra um existente que não é classe 5, mesmo sendo classe 5 o novo', () => {
    const notDecoration = claim('c-other', { statement: 'Carla Dias leads the technical side.', evidenceClass: 3 });
    expect(findDuplicateCandidate(CARLA_FACT, [notDecoration])).toBeNull();
  });

  it('nunca dispara quando não há nome próprio extraível na frase nova', () => {
    const noName = claim('c-noname', { statement: 'the team won a regional prize', evidenceClass: 5 });
    expect(findDuplicateCandidate(noName, [CARLA_PROFILE])).toBeNull();
  });

  it('ignora claims rejeitados no pool — uma decisão já tomada não é candidato a duplicado', () => {
    const rejected = claim('c-rejected', { statement: 'Carla Dias, CTO. Woman In Tech EU warded', evidenceClass: 5, status: 'rejected' });
    expect(findDuplicateCandidate(CARLA_FACT, [rejected])).toBeNull();
  });

  it('nunca compara um claim consigo próprio', () => {
    expect(findDuplicateCandidate(CARLA_FACT, [CARLA_FACT])).toBeNull();
  });

  it('não dispara quando não há sobreposição de nome nenhuma', () => {
    const other = claim('c-other-award', { statement: 'Rui Almeida won the national hackathon award, 2024', evidenceClass: 5 });
    expect(findDuplicateCandidate(CARLA_FACT, [other])).toBeNull();
  });
});

// Prompt 313 §B — a ligação real: o Grant Agreement (WomenTechEU/EISMEA)
// tem de resolver o claim da Carla Dias, o caso que motivou este prompt.
describe('findDocumentLinkCandidate (Prompt 313 §B) — a mesma mecânica do findDuplicateCandidate, agora contra factos de um documento', () => {
  const CARLA_CLAIM = claim('c-fact', { statement: 'Carla Dias is a WomenTechEU awardee', evidenceClass: 5 });
  const NAMED_ENTITY_FACT = { documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1, label: 'Carla Dias' };
  const PROGRAM_FACT = { documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1, label: 'WomenTechEU' };

  it('liga via o nome extraído coincidindo com um facto de entidade nomeada', () => {
    expect(findDocumentLinkCandidate(CARLA_CLAIM, [NAMED_ENTITY_FACT]))
      .toEqual({ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1 });
  });

  it('liga via o nome do programa aparecendo dentro do statement do claim', () => {
    expect(findDocumentLinkCandidate(CARLA_CLAIM, [PROGRAM_FACT]))
      .toEqual({ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1 });
  });

  it('nunca dispara para um claim que não é classe 5 (decoração)', () => {
    const named = claim('c-other', { statement: 'Carla Dias leads the technical side.', evidenceClass: 3 });
    expect(findDocumentLinkCandidate(named, [NAMED_ENTITY_FACT])).toBeNull();
  });

  it('nunca dispara quando não há nome próprio extraível na frase', () => {
    const noName = claim('c-noname', { statement: 'the team won a regional prize', evidenceClass: 5 });
    expect(findDocumentLinkCandidate(noName, [PROGRAM_FACT])).toBeNull();
  });

  it('não dispara quando não há sobreposição nenhuma', () => {
    const other = { documentId: 'doc-2', documentName: 'Unrelated.pdf', page: 1, label: 'Acme Corp' };
    expect(findDocumentLinkCandidate(CARLA_CLAIM, [other])).toBeNull();
  });

  it('devolve o primeiro facto correspondente entre vários', () => {
    const unrelated = { documentId: 'doc-2', documentName: 'Unrelated.pdf', page: 5, label: 'Acme Corp' };
    expect(findDocumentLinkCandidate(CARLA_CLAIM, [unrelated, NAMED_ENTITY_FACT]))
      .toEqual({ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1 });
  });
});

describe('proposeClaimFromDocumentFact (Prompt 313 §B) — só para factos de programa não cobertos, nasce já documentado', () => {
  const FACT = { label: 'WomenTechEU', page: 3, documentId: 'doc-1', documentName: 'Grant Agreement.pdf' };

  it('propõe um novo claim quando nenhum claim existente cobre o programa', () => {
    const proposal = proposeClaimFromDocumentFact(FACT, []);
    expect(proposal).not.toBeNull();
    expect(proposal?.category).toBe('validacao_externa');
    expect(proposal?.evidenceClass).toBe(5);
    expect(proposal?.sourceKind).toBe('vault_doc');
    expect(proposal?.documentRefs).toEqual([{ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 3 }]);
    expect(proposal?.statement).toContain('WomenTechEU');
    expect(proposal?.statement).toContain('Grant Agreement.pdf');
  });

  it('não propõe quando um claim classe-5 já existente menciona o mesmo programa', () => {
    const existing = claim('c-existing', { statement: 'Carla Dias is a WomenTechEU awardee', evidenceClass: 5, status: 'accepted' });
    expect(proposeClaimFromDocumentFact(FACT, [existing])).toBeNull();
  });

  it('ignora claims rejeitados ao decidir se já está coberto', () => {
    const rejected = claim('c-rejected', { statement: 'Carla Dias is a WomenTechEU awardee', evidenceClass: 5, status: 'rejected' });
    expect(proposeClaimFromDocumentFact(FACT, [rejected])).not.toBeNull();
  });

  it('ignora um claim que menciona o programa mas não é classe 5', () => {
    const notDecoration = claim('c-other', { statement: 'We applied to the WomenTechEU program', evidenceClass: 3, status: 'accepted' });
    expect(proposeClaimFromDocumentFact(FACT, [notDecoration])).not.toBeNull();
  });
});

describe('strengthenGaps (Prompt 358 §3.4) — o que falta EXACTAMENTE, nunca uma ladainha genérica', () => {
  it('devolve null (silêncio) para um claim já específico com quem+quando+resultado', () => {
    expect(strengthenGaps({ category: 'validacao_externa', sourceKind: 'founder_answer',
      statement: 'Acme Corp signed a pilot LOI with us in March 2026' })).toBeNull();
  });

  it('um claim de decoração (prémio) nunca pede "outcome" — o prémio já É o resultado', () => {
    expect(strengthenGaps({ category: 'equipa', sourceKind: 'roadmap',
      statement: 'Carla Dias won the WomenTechEU prize, €75,000 non-dilutive, 2022' })).toBeNull();
  });

  it('a fixture real do Nuno: falta exactamente o ano, nada mais', () => {
    expect(strengthenGaps({ category: 'equipa', sourceKind: 'fact',
      statement: 'Carla Dias is a WomenTechEU awardee' })).toEqual(['when']);
  });

  it('o vago clássico do 219 pede quem e resultado, não "quando" (a data existe)', () => {
    expect(strengthenGaps({ category: 'validacao_externa', sourceKind: 'fact',
      statement: "the world's manufacturing leader sent a committee to visit us for a week in 2026" })).toEqual(['who', 'outcome']);
  });

  it('categorias estruturadas (ask/funding) nunca aparecem — específicas por construção', () => {
    expect(strengthenGaps({ category: 'ask', sourceKind: 'profile', statement: 'Raising €300k.' })).toBeNull();
    expect(strengthenGaps({ category: 'funding', sourceKind: 'profile', statement: 'Use of funds: hiring.' })).toBeNull();
  });

  it('sourceKind de campo estruturado (profile/funding_round) nunca aparece, seja qual for a categoria', () => {
    expect(strengthenGaps({ category: 'mercado_timing', sourceKind: 'profile', statement: 'Operating in Digital Health from Portugal.' })).toBeNull();
    expect(strengthenGaps({ category: 'funding', sourceKind: 'funding_round', statement: 'Previous round of €500k closed in 2023.' })).toBeNull();
  });
});

describe('joinChipAndFreeText (Prompt 367) — a chip the founder naturally repeats in their own free text never duplicates', () => {
  it('the real fixture: free text continuing the chip drops the repeated prefix', () => {
    expect(joinChipAndFreeText('Not yet', "Not yet. Building what we're developing requires significant time and resources."))
      .toBe("Not yet. Building what we're developing requires significant time and resources.");
  });

  it('case-insensitive overlap is still caught', () => {
    expect(joinChipAndFreeText('Not yet', 'not yet, but we have LOIs.')).toBe('not yet, but we have LOIs.');
  });

  it('no overlap: chip and free text join with " — ", unchanged from before', () => {
    expect(joinChipAndFreeText('Not yet', 'we have LOIs for our first pilots')).toBe('Not yet — we have LOIs for our first pilots');
  });

  it('option alone (no free text) is returned as-is', () => {
    expect(joinChipAndFreeText('Not yet', undefined)).toBe('Not yet');
  });

  it('free text alone (no option) is returned as-is', () => {
    expect(joinChipAndFreeText(undefined, 'we have LOIs')).toBe('we have LOIs');
  });

  it('neither present returns an empty string', () => {
    expect(joinChipAndFreeText(undefined, undefined)).toBe('');
  });

  it('a free-text answer that merely CONTAINS the chip later on (not as a prefix) still joins normally', () => {
    expect(joinChipAndFreeText('Not yet', 'We are still working on it — not yet ready.'))
      .toBe('Not yet — We are still working on it — not yet ready.');
  });
});
