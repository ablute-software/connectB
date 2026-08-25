import { describe, expect, it } from 'vitest';
import { proposeMarketRings } from './market-rings';

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
