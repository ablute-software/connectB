import { describe, expect, it } from 'vitest';
import { violatesInvestorSafety, sanitizeInvestorSwot, INVESTOR_SAFE_INSTRUCTION } from './investor-safe-swot';
import { normalizeAtom, weakClaimCoachingNote } from './company-claims';

// Prompt 211 — as frases LITERAIS que fugiram para investidores em produção
// a 2026-08-16. Se alguma delas voltar a passar, este ficheiro cai.
const FUGIU = [
  'High pass rate: 42 total passes (31 explicit + dormant/contacted likely stalled) suggests pitch or readiness issues',
  'Low investor engagement: only 116 of 759 investors contacted (15%), indicating slow outreach velocity',
  'Only €100k soft-circled against €300k target (33% of round), leaving €200k funding gap',
];

describe('violatesInvestorSafety — as frases reais da fuga', () => {
  it.each(FUGIU)('apanha: %s', (frase) => {
    expect(violatesInvestorSafety(frase)).not.toBeNull();
  });
});

describe('violatesInvestorSafety — o que NAO deve apagar', () => {
  it('factos do negocio com numeros passam', () => {
    expect(violatesInvestorSafety('Two pilots signed with hospitals in Q3 2026')).toBeNull();
    expect(violatesInvestorSafety('Patent granted in 3 jurisdictions')).toBeNull();
    expect(violatesInvestorSafety('Team of 4, two with clinical backgrounds')).toBeNull();
  });

  it('termos do funil SEM numeros passam -- e a combinacao que revela', () => {
    expect(violatesInvestorSafety('Strong investor interest in the space')).toBeNull();
    expect(violatesInvestorSafety('The market has passed the early-adopter phase')).toBeNull();
  });

  it('qualitativo positivo sem numeros passa', () => {
    expect(violatesInvestorSafety('Clear regulatory pathway in the EU')).toBeNull();
  });
});

describe('sanitizeInvestorSwot', () => {
  it('deixa cair so os bullets que violam, e diz quais', () => {
    const r = sanitizeInvestorSwot({
      strengths: ['Patent granted in 3 jurisdictions'],
      weaknesses: [FUGIU[0], 'No CE marking yet'],
      opportunities: [], threats: [],
    });

    expect(r.data.strengths).toEqual(['Patent granted in 3 jurisdictions']);
    expect(r.data.weaknesses).toEqual(['No CE marking yet']);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].bullet).toBe(FUGIU[0]);
  });

  it('as tres frases reais caem todas', () => {
    const r = sanitizeInvestorSwot({ weaknesses: FUGIU, strengths: [], opportunities: [], threats: [] });
    expect(r.data.weaknesses).toEqual([]);
    expect(r.dropped).toHaveLength(3);
  });

  it('aguenta null/undefined sem lancar', () => {
    expect(sanitizeInvestorSwot(null).data).toEqual({ strengths: [], weaknesses: [], opportunities: [], threats: [] });
    expect(sanitizeInvestorSwot(undefined).dropped).toEqual([]);
  });

  it('nao inventa categorias nem reordena', () => {
    const r = sanitizeInvestorSwot({ strengths: ['a', 'b', 'c'], weaknesses: [], opportunities: [], threats: [] });
    expect(r.data.strengths).toEqual(['a', 'b', 'c']);
  });
});

describe('INVESTOR_SAFE_INSTRUCTION', () => {
  // Se alguem suavizar a instrucao, isto cai -- e a instrucao e metade da
  // defesa (a outra metade e o sanitize).
  it('proibe explicitamente cada classe que fugiu', () => {
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('pass or decline history');
    expect(t).toContain('contacted');
    expect(t).toContain('soft-circled');
    expect(t).toContain('funding gap');
  });

  it('proibe INFERIR, nao so citar', () => {
    expect(INVESTOR_SAFE_INSTRUCTION.toLowerCase()).toContain('must not infer or estimate');
  });
});

// Prompt 307 §B1 — factos desfavoraveis nao devem dominar o material do
// investidor: a instrucao deve pedir para liderar com os factos mais fortes,
// nunca promover um facto fraco/desfavoravel a manchete, mas tambem nunca
// pedir para inventar ou OMITIR um facto real so por ser desfavoravel.
describe('INVESTOR_SAFE_INSTRUCTION — enfase nos factos mais fortes (Prompt 307 SB1)', () => {
  it('pede para liderar com os factos confirmados mais fortes', () => {
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('lead');
    expect(t).toContain('strongest confirmed facts');
  });

  it('proibe promover um facto fraco/desfavoravel a manchete ou repeti-lo em varias seccoes', () => {
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('must never be promoted to a headline');
    expect(t).toContain('must never be repeated across multiple sections');
  });

  it('continua a exigir weaknesses/threats reais, so formuladas de forma construtiva', () => {
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('still include real weaknesses and threats');
    expect(t).toContain('constructively');
  });

  it('nunca pede para inventar ou omitir um facto real', () => {
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('never invent a fact');
    expect(t).toContain('never omit a confirmed fact');
  });
});

// Prompt 307 §B3 — o caso concreto do pedido: canon com um facto forte
// (award da founder) + um fraco (NDA parado). O limite de uso da API
// (activo ate 01/09) impede uma chamada real ao modelo aqui — o que segue e
// exactamente o que se consegue confirmar SEM provider: a classificacao
// mecanica de cada facto (que e o que alimenta tanto a instrucao dada ao
// modelo como a sugestao ao founder) e o texto da propria instrucao.
// Confirmar que o SWOT gerado de facto lidera com o award e nao com a NDA
// exige uma chamada real e fica registado como pendente no relatorio desta
// prompt, nao fabricado aqui.
describe('Prompt 307 SB3 — caso concreto: award forte + NDA fraca', () => {
  const AWARD = { category: 'equipa' as const, statement: 'Carla Dias won the WomenTechEU prize, €75,000 non-dilutive, 2022', sourceKind: 'roadmap' as const };
  const NDA_PARADA = { category: 'tracao_gtm' as const, statement: 'NDA signed, no further negotiations', sourceKind: 'fact' as const };

  it('o award classifica-se como alta especificidade — nao dispara coaching', () => {
    const claim = normalizeAtom(AWARD);
    expect(claim.specificity).toBe('high');
    expect(weakClaimCoachingNote(claim)).toBeNull();
  });

  it('a NDA parada classifica-se como baixa especificidade — dispara coaching founder-only', () => {
    const claim = normalizeAtom(NDA_PARADA);
    expect(claim.specificity).toBe('low');
    const note = weakClaimCoachingNote(claim);
    expect(note).not.toBeNull();
    expect(note).toContain('traction');
  });

  it('a instrucao investor-safe, dada este canon, pede para liderar pelo award e nunca pela NDA', () => {
    // Nao chama o modelo (limite de uso activo ate 01/09) -- confirma apenas
    // que a instrucao textual que o acompanharia contem a regra certa.
    const t = INVESTOR_SAFE_INSTRUCTION.toLowerCase();
    expect(t).toContain('lead');
    expect(t).toContain('must never be promoted to a headline');
  });
});
