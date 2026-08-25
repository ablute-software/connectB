import { describe, expect, it } from 'vitest';
import { projectMarketDataForInvestor } from './market-data-investor-projection';

describe('projectMarketDataForInvestor — devolve EXACTAMENTE os grupos ligados', () => {
  const FULL = {
    rings: [{ ring: 'beachhead' }], competitors: [{ name: 'Acme' }], rounds: [{ amount: 1 }],
    trends: ['AI in health'], regulatory: ['CE mark required'], definition: 'Digital health monitoring',
  };

  it('grupo "rings" ligado e "competitors" desligado — só rings sai', () => {
    const out = projectMarketDataForInvestor(['rings'], FULL);
    expect(out).toHaveProperty('rings');
    expect(out).not.toHaveProperty('competitors');
    expect(out).not.toHaveProperty('rounds');
    expect(out).not.toHaveProperty('trends');
    expect(out).not.toHaveProperty('regulatory');
    expect(out).not.toHaveProperty('definition');
  });

  it('nenhum grupo ligado — objecto vazio, nunca um fallback com tudo', () => {
    expect(projectMarketDataForInvestor([], FULL)).toEqual({});
  });

  it('todos os grupos ligados — tudo sai', () => {
    const out = projectMarketDataForInvestor(['rings', 'competitors', 'rounds', 'trends', 'regulatory', 'definition'], FULL);
    expect(out).toEqual(FULL);
  });

  it('uma chave desconhecida na lista de visíveis é ignorada, nunca cria uma propriedade nova', () => {
    const out = projectMarketDataForInvestor(['not_a_real_group'], FULL);
    expect(out).toEqual({});
  });
});
