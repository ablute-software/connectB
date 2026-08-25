import { describe, expect, it } from 'vitest';
import { pickPortraitDocuments, MAX_PORTRAIT_DOCS } from './market-portrait';

const doc = (id: string, name: string, folderName = '') => ({ id, name, folderName });

describe('pickPortraitDocuments (378 §D) — nunca varre a Vault inteira', () => {
  it('escolhe os documentos de mercado reais da ablute_ pelo nome', () => {
    const picked = pickPortraitDocuments([
      doc('1', 'Market_Sizing.pdf'),
      doc('2', 'Competitive_Landscape.pdf'),
      doc('3', 'Employment_contract_2024.pdf'),
      doc('4', 'ablute_ investor deck.pdf'),
    ]);
    expect(picked).toEqual(['1', '2', '4']);
  });

  it('apanha também por nome de pasta', () => {
    expect(pickPortraitDocuments([doc('1', 'Untitled.pdf', '05 Commercial, Market and Pilot')])).toEqual(['1']);
  });

  it('nada de mercado — devolve lista vazia, nunca "manda tudo"', () => {
    const picked = pickPortraitDocuments([doc('1', 'NDA.pdf'), doc('2', 'Payslip.pdf', '06 Team')]);
    expect(picked).toEqual([]);
  });

  it('respeita o tecto de documentos por passe (custo)', () => {
    const many = Array.from({ length: 20 }, (_, i) => doc(String(i), `Market ${i}.pdf`));
    expect(pickPortraitDocuments(many)).toHaveLength(MAX_PORTRAIT_DOCS);
  });
});
