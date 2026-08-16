import { describe, expect, it } from 'vitest';
import { withDocumentInfo, type DealMessage } from './deal-messages';

// Prompt 210 §A.4 — os casos chatos ficam presos aqui, e nao dependem de uma
// rota para acontecerem: documento apagado depois de enviado, id que nao
// pertence a org nenhuma, anexo que o leitor nao pode abrir.

function msg(over: Partial<DealMessage> = {}): DealMessage {
  return {
    id: 'm1', senderSide: 'founder', senderUserId: 'u1', body: 'aqui vai',
    links: [], documentIds: [], documents: [], createdAt: '2026-08-16T10:00:00.000Z', ...over,
  };
}

describe('withDocumentInfo', () => {
  const NAMES = new Map([['deck', 'Pitch deck'], ['memo', 'Investment memo']]);

  it('resolve nome e acesso', () => {
    const [m] = withDocumentInfo([msg({ documentIds: ['deck'] })], NAMES, new Set(['deck']));
    expect(m.documents).toEqual([{ id: 'deck', name: 'Pitch deck', accessible: true }]);
  });

  // O ponto do §A.4: anexar NAO cria acesso.
  it('documento conhecido mas sem acesso: nome sim, accessible nao', () => {
    const [m] = withDocumentInfo([msg({ documentIds: ['memo'] })], NAMES, new Set(['deck']));
    expect(m.documents).toEqual([{ id: 'memo', name: 'Investment memo', accessible: false }]);
  });

  it('documento apagado depois de enviado continua a aparecer, nunca acessivel', () => {
    const [m] = withDocumentInfo([msg({ documentIds: ['fantasma'] })], NAMES, new Set(['fantasma']));
    expect(m.documents).toEqual([{ id: 'fantasma', name: 'Document no longer available', accessible: false }]);
  });

  it('mantem a ordem e o numero de anexos', () => {
    const [m] = withDocumentInfo([msg({ documentIds: ['memo', 'deck'] })], NAMES, new Set(['deck']));
    expect(m.documents.map((d) => d.id)).toEqual(['memo', 'deck']);
    expect(m.documents.filter((d) => d.accessible)).toHaveLength(1);
  });

  it('mensagem sem anexos fica com lista vazia', () => {
    const [m] = withDocumentInfo([msg()], NAMES, new Set());
    expect(m.documents).toEqual([]);
  });

  it('nao mexe no resto da mensagem', () => {
    const original = msg({ documentIds: ['deck'], body: 'texto', links: [{ label: 'a', url: 'https://x' }] });
    const [m] = withDocumentInfo([original], NAMES, new Set(['deck']));
    expect(m.body).toBe('texto');
    expect(m.links).toEqual([{ label: 'a', url: 'https://x' }]);
    expect(m.documentIds).toEqual(['deck']);
  });

  it('varias mensagens de uma vez', () => {
    const out = withDocumentInfo(
      [msg({ id: 'a', documentIds: ['deck'] }), msg({ id: 'b', documentIds: ['memo'] })],
      NAMES, new Set(['deck']),
    );
    expect(out.map((m) => m.documents[0].accessible)).toEqual([true, false]);
  });
});
