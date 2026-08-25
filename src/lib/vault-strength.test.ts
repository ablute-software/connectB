import { describe, expect, it } from 'vitest';
import {
  classifyDocumentImportance, quantityScore, varietyScore, importanceScore, freshnessScore,
  vaultStrength, vaultStrengthLabel, topVaultSuggestion,
} from './vault-strength';

const NOW = new Date('2026-08-25T00:00:00Z');
// Deliberately empty: dataroomChecklist also matches on FOLDER names (e.g.
// hasFolder('commercial')), and these fixtures are specifically testing
// that DOCUMENT content drives variety — a folder name would confound that.
const FOLDERS: { name: string }[] = [];

function cvs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Founder CV ${i + 1}.pdf`, created_at: NOW.toISOString() }));
}

describe('classifyDocumentImportance — hierarquia por tipo', () => {
  it('prova externa verificável > interno estruturado > resumo', () => {
    expect(classifyDocumentImportance('Signed distribution agreement.pdf')).toBe('external_proof');
    expect(classifyDocumentImportance('Patent grant certificate.pdf')).toBe('external_proof');
    expect(classifyDocumentImportance('Financial model 2026.xlsx')).toBe('structured_internal');
    expect(classifyDocumentImportance('Investor deck v3.pdf')).toBe('summary');
    expect(classifyDocumentImportance('Founder CV.pdf')).toBe('summary');
  });
});

describe('quantityScore — retornos decrescentes', () => {
  it('o 3º documento vale mais, marginalmente, que o 30º', () => {
    const gainAt3 = quantityScore(3) - quantityScore(2);
    const gainAt30 = quantityScore(30) - quantityScore(29);
    expect(gainAt3).toBeGreaterThan(gainAt30);
  });

  it('satura perto de 1 depois de umas dezenas de documentos', () => {
    expect(quantityScore(30)).toBeLessThanOrEqual(1);
    expect(quantityScore(30)).toBeGreaterThan(0.9);
  });

  it('zero documentos é zero', () => {
    expect(quantityScore(0)).toBe(0);
  });
});

describe('varietyScore — reutiliza o MESMO checklist do cartão "Data Room completeness"', () => {
  it('10 CVs cobrem só UMA categoria', () => {
    expect(varietyScore(FOLDERS, cvs(10))).toBeCloseTo(1 / 9, 5);
  });

  it('CV + contrato + patente cobrem TRÊS categorias', () => {
    const docs = [
      { name: 'Founder CV.pdf', created_at: NOW.toISOString() },
      { name: 'Signed distribution agreement.pdf', created_at: NOW.toISOString() },
      { name: 'Patent grant certificate.pdf', created_at: NOW.toISOString() },
    ];
    expect(varietyScore(FOLDERS, docs)).toBeCloseTo(3 / 9, 5);
  });
});

describe('freshnessScore — documento crítico com mais de 12 meses pesa menos', () => {
  it('um contrato fresco pesa 1', () => {
    expect(freshnessScore([{ name: 'Signed agreement.pdf', created_at: NOW.toISOString() }], NOW)).toBe(1);
  });

  it('um contrato de há 2 anos pesa menos que 1, com piso 0.5', () => {
    const twoYearsAgo = new Date(NOW.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const score = freshnessScore([{ name: 'Signed agreement.pdf', created_at: twoYearsAgo }], NOW);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('sem datas, é neutro (1) — nunca penaliza por falta de informação', () => {
    expect(freshnessScore([{ name: 'Old deck.pdf' }], NOW)).toBe(1);
  });
});

describe('vaultStrength — a composição completa (fixture do prompt 374 §G)', () => {
  it('10 CVs pontuam ABAIXO de 1 CV + 1 contrato + 1 patente, apesar de menos documentos', () => {
    const tenCvs = vaultStrength(FOLDERS, cvs(10), NOW);
    const threeStrong = vaultStrength(FOLDERS, [
      { name: 'Founder CV.pdf', created_at: NOW.toISOString() },
      { name: 'Signed distribution agreement.pdf', created_at: NOW.toISOString() },
      { name: 'Patent grant certificate.pdf', created_at: NOW.toISOString() },
    ], NOW);
    expect(threeStrong.overall).toBeGreaterThan(tenCvs.overall);
  });

  it('nenhum documento é o mínimo (freshness fica neutro, sem nada para envelhecer)', () => {
    const empty = vaultStrength(FOLDERS, [], NOW);
    expect(empty.quantity).toBe(0);
    expect(empty.variety).toBe(0);
    expect(empty.importance).toBe(0);
    expect(empty.label).toBe('Thin');
  });
});

describe('vaultStrengthLabel — as quatro faixas', () => {
  it('mapeia os limiares correctamente', () => {
    expect(vaultStrengthLabel(0)).toBe('Thin');
    expect(vaultStrengthLabel(0.4)).toBe('Reasonable');
    expect(vaultStrengthLabel(0.6)).toBe('Strong');
    expect(vaultStrengthLabel(0.9)).toBe('Compelling');
  });
});

describe('topVaultSuggestion — o ÚNICO documento que mais ajudaria', () => {
  it('sugere a categoria em falta de maior alavancagem, não qualquer uma', () => {
    const docs = cvs(10); // covers only "Team bios / org chart"
    const suggestion = topVaultSuggestion(FOLDERS, docs, NOW);
    expect(suggestion).toMatch(/Commercial evidence|IP \(patents/);
  });

  it('com o checklist completo, sugere refrescar o documento crítico mais antigo', () => {
    const complete = [
      { name: 'Pitch deck.pdf', created_at: NOW.toISOString() },
      { name: 'One-pager.pdf', created_at: NOW.toISOString() },
      { name: 'Cap table.xlsx', created_at: NOW.toISOString() },
      { name: 'Financial model.xlsx', created_at: NOW.toISOString() },
      { name: 'Governance charter.pdf', created_at: NOW.toISOString() },
      { name: 'Team org chart.pdf', created_at: NOW.toISOString() },
      { name: 'Patent grant.pdf', created_at: new Date(NOW.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString() },
      { name: 'Signed pilot agreement.pdf', created_at: NOW.toISOString() },
      { name: 'Compliance certificate.pdf', created_at: NOW.toISOString() },
    ];
    const foldersFull = [
      { name: 'Corporate & Governance' }, { name: 'Regulatory & Compliance' }, { name: 'Commercial' },
    ];
    const suggestion = topVaultSuggestion(foldersFull, complete, NOW);
    expect(suggestion).toMatch(/Patent grant\.pdf.*over a year old/);
  });

  it('sem nada em falta e tudo fresco, diz que já cobre o essencial', () => {
    const complete = [
      { name: 'Pitch deck.pdf', created_at: NOW.toISOString() },
      { name: 'One-pager.pdf', created_at: NOW.toISOString() },
      { name: 'Cap table.xlsx', created_at: NOW.toISOString() },
      { name: 'Financial model.xlsx', created_at: NOW.toISOString() },
      { name: 'Governance charter.pdf', created_at: NOW.toISOString() },
      { name: 'Team org chart.pdf', created_at: NOW.toISOString() },
      { name: 'Patent grant.pdf', created_at: NOW.toISOString() },
      { name: 'Signed pilot agreement.pdf', created_at: NOW.toISOString() },
      { name: 'Compliance certificate.pdf', created_at: NOW.toISOString() },
    ];
    const foldersFull = [
      { name: 'Corporate & Governance' }, { name: 'Regulatory & Compliance' }, { name: 'Commercial' },
    ];
    expect(topVaultSuggestion(foldersFull, complete, NOW)).toMatch(/already covers the essentials/);
  });
});
