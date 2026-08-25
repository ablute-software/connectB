import { describe, expect, it } from 'vitest';
import { crossReferenceInvestors, investorHookLine } from './market-investor-bridge';

describe('investorHookLine — verdadeiro, derivado dos factos que já tem', () => {
  it('empresa + ano + tipo de ronda', () => {
    expect(investorHookLine({ companyName: 'Acme Health', investedAt: '2022-05-01', roundType: 'Series A' }))
      .toBe('invested in Acme Health in 2022, Series A round');
  });

  it('sem tipo de ronda, ainda assim verdadeiro', () => {
    expect(investorHookLine({ companyName: 'Beta Diagnostics', investedAt: '2021-01-01', roundType: null }))
      .toBe('invested in Beta Diagnostics in 2021');
  });

  it('sem data nem tipo — nunca inventa nenhum dos dois', () => {
    expect(investorHookLine({ companyName: 'Gamma Co', investedAt: null, roundType: null }))
      .toBe('invested in Gamma Co');
  });
});

describe('crossReferenceInvestors — "7 investidores, 3 já no pipeline, 4 não"', () => {
  const facts = [
    { investorEntityId: 'inv-1', investorName: 'Northbridge', companyName: 'Acme Health', amountEur: 2_000_000, investedAt: '2022-01-01', roundType: 'Seed' },
    { investorEntityId: 'inv-2', investorName: 'Atlas Ventures', companyName: 'Acme Health', amountEur: 5_000_000, investedAt: '2023-06-01', roundType: 'Series A' },
    // inv-1 also backed a second competitor, more recently — hook should
    // point at the MOST RECENT investment, not the first one seen.
    { investorEntityId: 'inv-1', investorName: 'Northbridge', companyName: 'Beta Diagnostics', amountEur: 1_000_000, investedAt: '2024-03-01', roundType: 'Seed extension' },
  ];
  const pipeline = new Map<string, string | null>([['inv-1', 'entity-abc'], ['inv-2', null]]);

  it('separa correctamente quem já está no pipeline de quem falta', () => {
    const { inPipeline, missing } = crossReferenceInvestors(facts, pipeline);
    expect(inPipeline.map((i) => i.investorEntityId)).toEqual(['inv-1']);
    expect(missing.map((i) => i.investorEntityId)).toEqual(['inv-2']);
  });

  it('um investidor que financiou 2 concorrentes aparece UMA vez, com ambos listados', () => {
    const { inPipeline } = crossReferenceInvestors(facts, pipeline);
    expect(inPipeline[0].backedCompanies).toHaveLength(2);
  });

  it('o gancho aponta para o investimento mais recente conhecido', () => {
    const { inPipeline } = crossReferenceInvestors(facts, pipeline);
    expect(inPipeline[0].hookLine).toBe('invested in Beta Diagnostics in 2024, Seed extension round');
  });

  it('um investidor nunca entregue a este org (sem linha no mapa) conta como missing', () => {
    const { missing } = crossReferenceInvestors(
      [{ investorEntityId: 'inv-3', investorName: 'Unknown Capital', companyName: 'Acme Health', amountEur: null, investedAt: null, roundType: null }],
      new Map(),
    );
    expect(missing).toHaveLength(1);
  });
});
