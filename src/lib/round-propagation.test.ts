import { describe, expect, it } from 'vitest';
import { parseAmountEur, detectPastRound, propagationTargets } from './round-propagation';

describe('parseAmountEur', () => {
  it('formatos com sufixo', () => {
    expect(parseAmountEur('€100k')).toBe(100_000);
    expect(parseAmountEur('100k')).toBe(100_000);
    expect(parseAmountEur('€1.3M')).toBe(1_300_000);
  });

  it('milhares escritos por extenso com separador', () => {
    expect(parseAmountEur('100.000€')).toBe(100_000);
    expect(parseAmountEur('300,000')).toBe(300_000);
  });

  it('decimal nao e confundido com milhar', () => {
    expect(parseAmountEur('1.3M')).toBe(1_300_000);
    expect(parseAmountEur('2,5M')).toBe(2_500_000);
  });

  it('sem numero nao inventa', () => {
    expect(parseAmountEur('raised a seed round')).toBeNull();
    expect(parseAmountEur('')).toBeNull();
  });
});

describe('detectPastRound — exige TRES sinais, nao dois', () => {
  const AGORA = { currentYear: 2026 };

  it('passado explicito + montante + termo: sugere', () => {
    expect(detectPastRound('Raised €100k pre-seed', AGORA))
      .toEqual({ amountEur: 100_000, suggestedLabel: 'Raised' });
  });

  it('ano anterior conta como prova de que ja aconteceu', () => {
    expect(detectPastRound('Seed round €250k', { periodYear: 2024, currentYear: 2026 })?.amountEur)
      .toBe(250_000);
  });

  // A armadilha: um milestone de roadmap e normalmente sobre o FUTURO.
  it('PLANO de fundraising NAO sugere -- "Raise €300k seed" e o plano', () => {
    expect(detectPastRound('Raise €300k seed', AGORA)).toBeNull();
    expect(detectPastRound('Raising €300k', { periodYear: 2027, currentYear: 2026 })).toBeNull();
  });

  it('sem termo de ronda nao sugere, mesmo com montante e passado', () => {
    expect(detectPastRound('Closed €50k in sales', AGORA)).toBeNull();
  });

  it('sem montante nao sugere', () => {
    expect(detectPastRound('Raised our pre-seed', AGORA)).toBeNull();
  });

  it('portugues tambem', () => {
    expect(detectPastRound('Levantados 100.000€ em ronda pre-seed', AGORA)?.amountEur).toBe(100_000);
  });
});

describe('propagationTargets — a lista e verdadeira, nao generica', () => {
  it('o alvo da ronda sai sempre para o investidor', () => {
    const t = propagationTargets('round_target_eur', { progressVisibleToInvestors: false });
    expect(t.some((x) => x.includes('Investor portal'))).toBe(true);
  });

  it('o valor garantido NAO lista o portal quando o toggle esta desligado', () => {
    const ligado = propagationTargets('round_secured_eur', { progressVisibleToInvestors: true });
    const desligado = propagationTargets('round_secured_eur', { progressVisibleToInvestors: false });
    expect(ligado.some((x) => x.includes('Investor portal'))).toBe(true);
    expect(desligado.some((x) => x.includes('Investor portal'))).toBe(false);
  });

  it('rondas anteriores nao entram na barra de progresso', () => {
    const t = propagationTargets('funding_rounds', { progressVisibleToInvestors: true });
    expect(t.join(' ')).toContain('company history');
    expect(t.some((x) => x.includes('Investor portal (people'))).toBe(false);
  });

  it('todas as listas sao curtas', () => {
    for (const f of ['round_target_eur', 'round_secured_eur', 'funding_rounds'] as const) {
      expect(propagationTargets(f, { progressVisibleToInvestors: true }).length).toBeLessThanOrEqual(4);
    }
  });
});
