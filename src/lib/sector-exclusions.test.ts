import { describe, it, expect } from 'vitest';
import { normalizeSectorTerms, exclusionTerms, termsCollide, isSectorExcluded } from './sector-exclusions';

// Os quatro perfis com exclusões preenchidas em produção a 2026-08-15, mais
// os rótulos reais da taxonomia (sector-taxonomy.ts) e os sectores livres que
// já existem em matchdeal_profiles ("saas", "health"). A migração 0172 tem de
// dar exactamente os mesmos resultados em SQL.
describe('normalizeSectorTerms', () => {
  it('separa os rótulos compostos da taxonomia', () => {
    expect(normalizeSectorTerms(['AgriTech & FoodTech'])).toEqual(['agritech', 'foodtech']);
    expect(normalizeSectorTerms(['Longevity, AgeTech & Wellness'])).toEqual(['longevity', 'agetech', 'wellness']);
    expect(normalizeSectorTerms(['MedTech & Medical Devices'])).toEqual(['medtech', 'medical devices']);
    expect(normalizeSectorTerms(['Adult content / pornography'])).toEqual(['adult content', 'pornography']);
  });

  it('nao separa por espacos -- "digital health" fica um termo so', () => {
    expect(normalizeSectorTerms(['Digital Health'])).toEqual(['digital health']);
    expect(normalizeSectorTerms(['AI, Data & Analytics'])).toEqual(['ai', 'data', 'analytics']);
  });

  it('ignora vazios, repetidos e pontuacao solta', () => {
    expect(normalizeSectorTerms([null, undefined, '', '  ;; // ', 'SaaS', 'saas'])).toEqual(['saas']);
  });
});

describe('exclusionTerms', () => {
  it('junta o array estruturado e o texto livre', () => {
    expect(exclusionTerms(['Adult content / pornography', 'Discrimination'], null))
      .toEqual(['adult content', 'pornography', 'discrimination']);
    expect(exclusionTerms([], 'foodtech; agritech')).toEqual(['foodtech', 'agritech']);
    expect(exclusionTerms(['Weapons'], 'no gambling')).toEqual(['weapons', 'no gambling']);
  });
});

describe('termsCollide', () => {
  it('regra A -- palavras inteiras, nos dois sentidos', () => {
    expect(termsCollide('digital health', 'health')).toBe(true);
    expect(termsCollide('foodtech', 'no foodtech please')).toBe(true);
  });

  it('regra A nao apanha pedacos de palavra', () => {
    expect(termsCollide('agritech', 'tech')).toBe(false);
    expect(termsCollide('retail', 'ai')).toBe(false);
    expect(termsCollide('biotechnology', 'bio')).toBe(false);
  });

  it('regra B -- mesma palavra escrita com e sem espaco', () => {
    expect(termsCollide('foodtech', 'food tech')).toBe(true);
    expect(termsCollide('medtech', 'Medtech'.toLowerCase())).toBe(true);
    expect(termsCollide('digital health', 'digitalhealth')).toBe(true);
  });

  it('regra B e igualdade, nunca substring', () => {
    expect(termsCollide('retail', 'ai')).toBe(false);
    expect(termsCollide('fintech', 'tech')).toBe(false);
  });
});

describe('isSectorExcluded -- casos reais de producao', () => {
  const AGRI = ['AgriTech & FoodTech'];
  const HEALTH = ['Digital Health', 'MedTech & Medical Devices', 'DeepTech'];

  it('perfil 2a8e2de8: "foodtech; agritech" exclui AgriTech & FoodTech', () => {
    expect(isSectorExcluded(AGRI, [], 'foodtech; agritech')).toBe(true);
  });

  it('perfil 637f8c2a: "food tech" (com espaco) exclui AgriTech & FoodTech', () => {
    expect(isSectorExcluded(AGRI, [], 'food tech')).toBe(true);
  });

  it('perfil 86a2a13d: "Medtech" exclui MedTech & Medical Devices', () => {
    expect(isSectorExcluded(HEALTH, [], 'Medtech')).toBe(true);
  });

  it('perfil 54e46c2e: exclusions_sectors estruturado', () => {
    expect(isSectorExcluded(['Adult Content'], ['Adult content / pornography', 'Discrimination'], null)).toBe(true);
    expect(isSectorExcluded(HEALTH, ['Adult content / pornography', 'Discrimination'], null)).toBe(false);
  });

  it('nao exclui quem nao tem nada a ver', () => {
    expect(isSectorExcluded(HEALTH, [], 'foodtech; agritech')).toBe(false);
    expect(isSectorExcluded(['SaaS & Enterprise Software'], [], 'foodtech')).toBe(false);
  });

  it('sem exclusoes ou sem sectores nao exclui nada', () => {
    expect(isSectorExcluded(HEALTH, [], null)).toBe(false);
    expect(isSectorExcluded(HEALTH, [], '   ')).toBe(false);
    expect(isSectorExcluded([], [], 'foodtech')).toBe(false);
    expect(isSectorExcluded(null, null, null)).toBe(false);
  });

  it('sectores livres em minusculas ("health") tambem sao apanhados', () => {
    expect(isSectorExcluded(['saas', 'health'], [], 'health')).toBe(true);
    expect(isSectorExcluded(['saas', 'health'], [], 'foodtech')).toBe(false);
  });
});
