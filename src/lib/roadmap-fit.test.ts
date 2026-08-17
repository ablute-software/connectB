import { describe, expect, it } from 'vitest';
import {
  fitRoadmap, lensYears, filterToYear, NATURAL_COLUMN_PX, BASE_FONT_PX, FLOOR_FONT_PX,
} from './roadmap-fit';

// Prompt 213 §C — a aritmética do "cabe?", presa em teste antes do render.

describe('fitRoadmap', () => {
  it('cabe folgado: escala 1, sem lupa', () => {
    // 3 colunas × 240 = 720, num contentor de 1000.
    expect(fitRoadmap(1000, 3)).toEqual({ mode: 'fit', scale: 1 });
  });

  it('nunca amplia acima de 1 — largura a mais nao estica os cartoes', () => {
    expect(fitRoadmap(5000, 2).scale).toBe(1);
  });

  it('comprime ate ao piso e ainda e fit', () => {
    // scale exactamente 11/12: fonte fica a 11px, no limiar — ainda legivel.
    const cols = 4;
    const width = cols * NATURAL_COLUMN_PX * (FLOOR_FONT_PX / BASE_FONT_PX);
    const r = fitRoadmap(width, cols);
    expect(r.mode).toBe('fit');
    expect(BASE_FONT_PX * r.scale).toBeCloseTo(FLOOR_FONT_PX, 5);
  });

  it('abaixo do piso entra a lupa, e a escala FIXA-SE no piso', () => {
    // 8 colunas × 240 = 1920 num contentor de 900: precisaria de 0.47,
    // fonte a ~5.6px — ilegivel. A lupa entra e a escala e 11/12.
    const r = fitRoadmap(900, 8);
    expect(r.mode).toBe('lens');
    expect(r.scale).toBeCloseTo(FLOOR_FONT_PX / BASE_FONT_PX, 5);
  });

  it('escolher um ano reduz as colunas e volta a caber', () => {
    // O caminho completo da lupa: 8 colunas nao cabem em 900; um ano com 2
    // marcos (3 colunas com o Founded) cabe com folga.
    expect(fitRoadmap(900, 8).mode).toBe('lens');
    expect(fitRoadmap(900, 3).mode).toBe('fit');
  });

  it('inputs degenerados nao rebentam', () => {
    expect(fitRoadmap(0, 5)).toEqual({ mode: 'fit', scale: 1 });
    expect(fitRoadmap(800, 0)).toEqual({ mode: 'fit', scale: 1 });
  });
});

describe('lensYears / filterToYear', () => {
  const MS = [
    { period_kind: 'year' as const, period_year: 2024 },
    { period_kind: 'quarter' as const, period_year: 2022, period_quarter: 2 },
    { period_kind: 'quarter' as const, period_year: 2024, period_quarter: 4 },
    { period_kind: 'year' as const, period_year: 2026 },
  ];

  it('um chip por ano, ordenado, sem repetidos', () => {
    expect(lensYears(MS)).toEqual([2022, 2024, 2026]);
  });

  it('filtrar por ano devolve so esse troco', () => {
    expect(filterToYear(MS, 2024)).toHaveLength(2);
    expect(filterToYear(MS, 2024).every((m) => m.period_year === 2024)).toBe(true);
  });

  it('null e a vista completa', () => {
    expect(filterToYear(MS, null)).toEqual(MS);
  });
});
