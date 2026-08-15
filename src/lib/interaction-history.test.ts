import { describe, expect, it } from 'vitest';
import { firstLine, recentInteractions, resolveSharedVersion } from './interaction-history';
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

describe('resolveSharedVersion (202 §F — que versao e que eles viram)', () => {
  const V = [
    { document_id: 'deck', version: 1, uploaded_at: '2026-01-01T00:00:00.000Z' },
    { document_id: 'deck', version: 2, uploaded_at: '2026-06-01T00:00:00.000Z' },
    { document_id: 'deck', version: 3, uploaded_at: '2026-08-10T00:00:00.000Z' },
    { document_id: 'outro', version: 9, uploaded_at: '2026-01-01T00:00:00.000Z' },
  ];

  it('sem documento nao ha nada a resolver', () => {
    expect(resolveSharedVersion(V, undefined, '2026-07-01T00:00:00.000Z')).toEqual({ kind: 'none' });
  });

  it('documento sem versoes registadas', () => {
    expect(resolveSharedVersion(V, 'one-pager', '2026-07-01T00:00:00.000Z')).toEqual({ kind: 'unversioned' });
  });

  it('devolve a versao em vigor A DATA, nao a mais recente', () => {
    expect(resolveSharedVersion(V, 'deck', '2026-07-01T00:00:00.000Z')).toEqual({ kind: 'at_time', version: 2 });
  });

  it('no proprio instante do upload ja conta essa versao', () => {
    expect(resolveSharedVersion(V, 'deck', '2026-06-01T00:00:00.000Z')).toEqual({ kind: 'at_time', version: 2 });
  });

  it('depois da ultima versao devolve a ultima', () => {
    expect(resolveSharedVersion(V, 'deck', '2026-08-15T00:00:00.000Z')).toEqual({ kind: 'at_time', version: 3 });
  });

  // O caso honesto: interacao anterior a qualquer versao registada. Nao
  // fingimos que sabemos qual era -- marcamos como "actual, nao a da altura".
  it('interacao anterior a todas as versoes NAO finge precisao', () => {
    expect(resolveSharedVersion(V, 'deck', '2025-11-27T00:00:00.000Z')).toEqual({ kind: 'current_only', version: 1 });
  });

  it('nao mistura versoes de outros documentos', () => {
    expect(resolveSharedVersion(V, 'deck', '2026-02-01T00:00:00.000Z')).toEqual({ kind: 'at_time', version: 1 });
  });
});
