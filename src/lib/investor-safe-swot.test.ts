import { describe, expect, it } from 'vitest';
import { violatesInvestorSafety, sanitizeInvestorSwot, INVESTOR_SAFE_INSTRUCTION } from './investor-safe-swot';

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
