import { describe, expect, it } from 'vitest';
import { firstLine, recentInteractions } from './interaction-history';
import type { Interaction } from './types';

function i(over: Partial<Interaction>): Interaction {
  return {
    id: 'x', entity_id: 'e1', direction: 'in', channel: 'email',
    content: 'olá', occurred_at: '2026-08-01T10:00:00.000Z', ...over,
  } as Interaction;
}

describe('firstLine', () => {
  it('devolve a primeira linha nao vazia', () => {
    expect(firstLine('\n\n  Olá Nuno,\nobrigado pelo deck.')).toBe('Olá Nuno,');
  });

  it('colapsa espacos', () => {
    expect(firstLine('Olá    Nuno,\t\tobrigado')).toBe('Olá Nuno, obrigado');
  });

  it('corta com reticencias acima do maximo', () => {
    const r = firstLine('a'.repeat(200), 20);
    expect(r).toHaveLength(20);
    expect(r.endsWith('…')).toBe(true);
  });

  it('nao corta o que cabe exactamente', () => {
    expect(firstLine('12345', 5)).toBe('12345');
  });

  it('aguenta conteudo vazio ou ausente', () => {
    expect(firstLine('')).toBe('');
    expect(firstLine(undefined)).toBe('');
    expect(firstLine('   \n  \n ')).toBe('');
  });
});

describe('recentInteractions', () => {
  const todas = [
    i({ id: 'a', occurred_at: '2026-07-01T10:00:00.000Z' }),
    i({ id: 'b', occurred_at: '2026-08-05T10:00:00.000Z' }),
    i({ id: 'c', occurred_at: '2026-08-01T10:00:00.000Z' }),
    i({ id: 'd', entity_id: 'outra', occurred_at: '2026-08-09T10:00:00.000Z' }),
  ];

  it('mais recente primeiro', () => {
    expect(recentInteractions(todas, 'e1').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('nao mistura outras entidades', () => {
    expect(recentInteractions(todas, 'e1').some((x) => x.id === 'd')).toBe(false);
  });

  it('respeita o limite', () => {
    expect(recentInteractions(todas, 'e1', 2).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('entidade sem nada devolve vazio', () => {
    expect(recentInteractions(todas, 'nenhuma')).toEqual([]);
  });
});
