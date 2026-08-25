import { describe, expect, it } from 'vitest';
import { proposeMarketRings, hasAnyKnowledge, stageLabel, vaultCitation, parseVaultCitation } from './market-rings';

// Prompt 378 §B — the exact defects the founder saw on the real site.
describe('proposeMarketRings — gramática do fallback (378 §B.4)', () => {
  it('NUNCA imprime um enum cru como pre_seed na prosa', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: 'pre_seed', country: 'Portugal', oneLiner: null, sizingFacts: [],
    });
    for (const r of rings) {
      expect(r.definition).not.toMatch(/pre_seed|series_a|series_b_plus/);
    }
    expect(rings.find((r) => r.ring === 'serviceable')!.definition).toMatch(/pre-seed/);
  });

  it('o one-liner é uma FRASE PRÓPRIA, nunca colado a meio da frase do template', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: 'pre_seed', country: 'Portugal',
      oneLiner: 'health and wellness autonomous monitoring with daily insight', sizingFacts: [],
    });
    const beachhead = rings.find((r) => r.ring === 'beachhead')!;
    // a frase do template fecha com ponto ANTES do one-liner começar
    expect(beachhead.definition).toMatch(/reaches\. health and wellness/);
    // e o one-liner ganha pontuação final própria
    expect(beachhead.definition.trim().endsWith('.')).toBe(true);
  });

  it('um stage desconhecido é omitido da frase, nunca impresso cru', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: 'some_new_stage', country: null, oneLiner: null, sizingFacts: [],
    });
    expect(rings.find((r) => r.ring === 'serviceable')!.definition).not.toMatch(/some_new_stage/);
  });

  it('stageLabel mapeia os enums reais e devolve null para o desconhecido', () => {
    expect(stageLabel('pre_seed')).toBe('pre-seed');
    expect(stageLabel('series_b_plus')).toBe('Series B+');
    expect(stageLabel('nonsense')).toBeNull();
    expect(stageLabel(null)).toBeNull();
  });
});

describe('hasAnyKnowledge (378 §B.3) — sem conhecimento não se propõe madlibs', () => {
  it('sector sozinho NÃO é conhecimento sobre o mercado do founder', () => {
    expect(hasAnyKnowledge({ sectors: ['Digital Health'], stage: 'seed', country: 'Portugal', oneLiner: 'x', sizingFacts: [] })).toBe(false);
  });
  it('um facto de sizing real é conhecimento', () => {
    expect(hasAnyKnowledge({
      sectors: [], stage: null, country: null, oneLiner: null,
      sizingFacts: [{ scopeLabel: 'TAM Europe', valueEur: 1, year: null, sourceUrl: 'https://e.com', method: 'report' }],
    })).toBe(true);
  });
});

describe('citação interna do Vault (378 §B.2) — nunca um URL inventado', () => {
  it('faz round-trip de documento + página', () => {
    const c = vaultCitation('abc-123', 4);
    expect(c).toBe('doc:abc-123#p4');
    expect(parseVaultCitation(c)).toEqual({ documentId: 'abc-123', page: 4 });
  });
  it('aceita documento sem página', () => {
    expect(parseVaultCitation(vaultCitation('abc-123', null))).toEqual({ documentId: 'abc-123', page: null });
  });
  it('um URL externo real não é uma citação de documento', () => {
    expect(parseVaultCitation('https://example.com/report')).toBeNull();
    expect(parseVaultCitation(null)).toBeNull();
  });
});

describe('proposeMarketRings — nunca inventa um número sem fonte', () => {
  it('sem sizing facts, os três anéis vêm com definição mas SEM número', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: 'pre_seed', country: 'Portugal', oneLiner: 'A 360º health biosphere.',
      sizingFacts: [],
    });
    expect(rings).toHaveLength(3);
    for (const r of rings) {
      expect(r.sizeValueEur).toBeNull();
      expect(r.sizeSourceUrl).toBeNull();
      expect(r.definition.length).toBeGreaterThan(0);
    }
  });

  it('uma sizing fact SOM vai para beachhead, SAM para serviceable, TAM para category', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: 'pre_seed', country: 'Portugal', oneLiner: null,
      sizingFacts: [
        { scopeLabel: 'SOM Portugal hospitals', valueEur: 5_000_000, year: 2026, sourceUrl: 'https://example.com/som', method: 'bottom_up' },
        { scopeLabel: 'SAM Europe', valueEur: 200_000_000, year: 2026, sourceUrl: 'https://example.com/sam', method: 'top_down' },
        { scopeLabel: 'TAM Global', valueEur: 3_000_000_000, year: 2025, sourceUrl: 'https://example.com/tam', method: 'report' },
      ],
    });
    const byRing = Object.fromEntries(rings.map((r) => [r.ring, r]));
    expect(byRing.beachhead.sizeValueEur).toBe(5_000_000);
    expect(byRing.beachhead.sizeSourceUrl).toBe('https://example.com/som');
    expect(byRing.serviceable.sizeValueEur).toBe(200_000_000);
    expect(byRing.category.sizeValueEur).toBe(3_000_000_000);
  });

  it('uma sizing fact sem palavra-chave reconhecível não é atribuída a nenhum anel — nunca um palpite', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: null, country: null, oneLiner: null,
      sizingFacts: [{ scopeLabel: 'Some vague market number', valueEur: 1_000_000, year: null, sourceUrl: 'https://example.com', method: 'report' }],
    });
    expect(rings.every((r) => r.sizeValueEur === null)).toBe(true);
  });

  it('duas sizing facts para o MESMO anel — a primeira ganha, nunca soma nem escolhe "a maior"', () => {
    const rings = proposeMarketRings({
      sectors: ['Digital Health'], stage: null, country: null, oneLiner: null,
      sizingFacts: [
        { scopeLabel: 'TAM v1', valueEur: 1_000_000, year: 2024, sourceUrl: 'https://a.example.com', method: 'top_down' },
        { scopeLabel: 'TAM v2', valueEur: 9_000_000, year: 2026, sourceUrl: 'https://b.example.com', method: 'report' },
      ],
    });
    const category = rings.find((r) => r.ring === 'category')!;
    expect(category.sizeValueEur).toBe(1_000_000);
    expect(category.sizeSourceUrl).toBe('https://a.example.com');
  });
});
