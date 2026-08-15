import { describe, expect, it } from 'vitest';
import { firstLine, formatAsk, recentInteractions, resolveSharedVersion, unclassifiedInbound } from './interaction-history';
import type { Interaction } from './types';

function i(over: Partial<Interaction>): Interaction {
  return {
    id: 'x', entity_id: 'e1', direction: 'in', channel: 'email',
    content: 'olá', occurred_at: '2026-08-01T10:00:00.000Z', ...over,
  } as Interaction;
}

// Prompt 208 §A — o email LITERAL da Adara Ventures, copiado da interacao
// d91c5d42 em producao (2026-08-05). A linha mostrada era "Dear Nuno,".
const ADARA = [
  'Dear Nuno,',
  'Thank you for getting in touch with us through our website. After reviewing and debating internally the information you uploaded, we have decided not to pursue a potential investment. We thank you for thinking of Adara as a possible investor and wish you the best for your fundraising process.',
  '',
  'Sincerely,',
  '',
  'Alexei Perley',
  'www.adara.vc | GDPR',
].join('\n');

describe('firstLine — o caso Adara', () => {
  it('NAO mostra a saudacao', () => {
    expect(firstLine(ADARA)).not.toBe('Dear Nuno,');
    expect(firstLine(ADARA).startsWith('Dear')).toBe(false);
  });

  it('mostra a frase que carrega a decisao', () => {
    expect(firstLine(ADARA)).toContain('not to pursue');
  });

  it('respeita o limite de comprimento', () => {
    expect(firstLine(ADARA).length).toBeLessThanOrEqual(90);
    expect(firstLine(ADARA, 60).length).toBeLessThanOrEqual(60);
  });
});

describe('firstLine', () => {
  // MUDANCA DE CONTRATO (208 §A): antes era "a primeira linha nao vazia",
  // agora e "a primeira linha SUBSTANTIVA". Este teste asseverava o
  // comportamento antigo e foi reescrito de proposito, nao adaptado.
  it('salta a saudacao e vai a linha com conteudo', () => {
    expect(firstLine('\n\n  Ola Nuno,\nobrigado pelo deck que enviaste.')).toBe('obrigado pelo deck que enviaste.');
  });

  it('linhas curtas de mais nao contam como substantivas', () => {
    expect(firstLine('Hi,\nJoao\nPodemos falar na proxima semana sobre a ronda?'))
      .toBe('Podemos falar na proxima semana sobre a ronda?');
  });

  it('sem palavra inteira nao e saudacao: "Hint" nao e "Hi"', () => {
    expect(firstLine('Hint: os numeros do Q3 estao no anexo em baixo.'))
      .toBe('Hint: os numeros do Q3 estao no anexo em baixo.');
  });

  it('so saudacao: mostra a saudacao, nao vazio', () => {
    expect(firstLine('Dear Nuno,')).toBe('Dear Nuno,');
  });

  it('prefere a frase com sinal mesmo no meio do paragrafo', () => {
    const txt = 'Obrigado pelo envio dos materiais todos. Unfortunately this is too early for us. Bom trabalho.';
    expect(firstLine(txt)).toContain('Unfortunately');
  });

  it('sem sinal nenhum: primeira frase substantiva, truncada se preciso', () => {
    const r = firstLine('a'.repeat(200), 20);
    expect(r).toHaveLength(20);
    expect(r.endsWith('…')).toBe(true);
  });

  it('colapsa espacos', () => {
    expect(firstLine('Reuniao    marcada\t\tpara terca de manha')).toBe('Reuniao marcada para terca de manha');
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

describe('formatAsk (202 §D)', () => {
  it('milhoes com e sem casa decimal', () => {
    expect(formatAsk(1_300_000)).toBe('€1.3M');
    expect(formatAsk(2_000_000)).toBe('€2M');
  });

  it('milhares', () => {
    expect(formatAsk(300_000)).toBe('€300k');
    expect(formatAsk(1_500)).toBe('€2k');
  });

  it('valores pequenos ficam literais', () => {
    expect(formatAsk(500)).toBe('€500');
  });

  // O ponto todo: "nao registado" nao pode aparecer como "€0".
  it('ausente devolve undefined, nunca "€0"', () => {
    expect(formatAsk(undefined)).toBeUndefined();
    expect(formatAsk(null)).toBeUndefined();
    expect(formatAsk(NaN)).toBeUndefined();
  });

  it('zero registado a serio continua a ser zero', () => {
    expect(formatAsk(0)).toBe('€0');
  });
});

describe('unclassifiedInbound (208 §D)', () => {
  const todas = [
    i({ id: 'out', direction: 'out', classification: 'awaiting', occurred_at: '2025-11-27T10:00:00.000Z' }),
    i({ id: 'nova', classification: 'awaiting', occurred_at: '2026-08-05T10:00:00.000Z' }),
    i({ id: 'velha', classification: undefined, occurred_at: '2026-01-05T10:00:00.000Z' }),
    i({ id: 'feita', classification: 'pass', occurred_at: '2026-02-05T10:00:00.000Z' }),
    i({ id: 'outra-ent', entity_id: 'outra', classification: 'awaiting', occurred_at: '2026-03-05T10:00:00.000Z' }),
  ];

  it('mais antiga primeiro -- e a que esta ha mais tempo a enganar o resto da app', () => {
    expect(unclassifiedInbound(todas, 'e1').map((x) => x.id)).toEqual(['velha', 'nova']);
  });

  it('ignora outbound, ja classificadas e outras entidades', () => {
    const ids = unclassifiedInbound(todas, 'e1').map((x) => x.id);
    expect(ids).not.toContain('out');
    expect(ids).not.toContain('feita');
    expect(ids).not.toContain('outra-ent');
  });

  it('sem nada por classificar devolve vazio', () => {
    expect(unclassifiedInbound([todas[3]], 'e1')).toEqual([]);
  });
});
