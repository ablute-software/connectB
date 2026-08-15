import { describe, expect, it } from 'vitest';
import { findEffectiveGrant, computeCellEffect, type MatrixGrant } from './people-access-matrix';

// Prompt 204 §A/§B — a matriz do founder tinha a MESMA raiz que o portal do
// investidor: match directo de pasta, sem descer a subárvore. Resultado: um
// grant na raiz "Vault Data Room" mostrava "not shared" em tudo o que estava
// nas subpastas, que é exactamente a queixa "o founder não vê o que foi
// concedido". Este ficheiro não existia — a função nunca teve testes.

const PESSOAS = new Set(['p1']);
const ARVORE = [{ id: 'raiz' }, { id: 'sum', parent_id: 'raiz' }, { id: 'anexos', parent_id: 'sum' }];
const NOW = new Date('2026-08-15T00:00:00.000Z');

function grant(over: Partial<MatrixGrant>): MatrixGrant {
  return { person_id: 'p1', nda_required: false, ...over } as MatrixGrant;
}

describe('findEffectiveGrant — grant de pasta cobre a subárvore', () => {
  it('grant na raiz decide um documento numa subpasta', () => {
    const g = grant({ folder_id: 'raiz' });
    expect(findEffectiveGrant([g], 'd1', 'sum', PESSOAS, ARVORE)).toBe(g);
  });

  it('desce mais do que um nível', () => {
    const g = grant({ folder_id: 'raiz' });
    expect(findEffectiveGrant([g], 'd1', 'anexos', PESSOAS, ARVORE)).toBe(g);
  });

  it('o ancestral mais próximo ganha ao mais distante', () => {
    const raiz = grant({ folder_id: 'raiz' });
    const sub = grant({ folder_id: 'sum', nda_required: true });
    expect(findEffectiveGrant([raiz, sub], 'd1', 'anexos', PESSOAS, ARVORE)).toBe(sub);
  });

  it('o grant por documento continua a ganhar a qualquer pasta', () => {
    const raiz = grant({ folder_id: 'raiz' });
    const doc = grant({ document_id: 'd1', nda_required: true });
    expect(findEffectiveGrant([raiz, doc], 'd1', 'sum', PESSOAS, ARVORE)).toBe(doc);
  });

  it('grants de outra pessoa não contam', () => {
    const g = grant({ folder_id: 'raiz', person_id: 'outra' });
    expect(findEffectiveGrant([g], 'd1', 'sum', PESSOAS, ARVORE)).toBeUndefined();
  });

  it('sem árvore, só o match directo', () => {
    const g = grant({ folder_id: 'raiz' });
    expect(findEffectiveGrant([g], 'd1', 'sum', PESSOAS, [])).toBeUndefined();
    expect(findEffectiveGrant([g], 'd1', 'raiz', PESSOAS, [])).toBe(g);
  });

  it('um ciclo em parent_id não pendura', () => {
    const ciclo = [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }];
    expect(findEffectiveGrant([grant({ folder_id: 'z' })], 'd1', 'a', PESSOAS, ciclo)).toBeUndefined();
  });
});

describe('computeCellEffect sobre um grant herdado', () => {
  it('herdado sem NDA lê-se shared', () => {
    const g = findEffectiveGrant([grant({ folder_id: 'raiz' })], 'd1', 'sum', PESSOAS, ARVORE);
    expect(computeCellEffect(g, NOW)).toBe('shared');
  });

  it('herdado com NDA por aceitar lê-se pendente, não shared', () => {
    const g = findEffectiveGrant([grant({ folder_id: 'raiz', nda_required: true })], 'd1', 'sum', PESSOAS, ARVORE);
    expect(computeCellEffect(g, NOW)).toBe('shared_pending_nda');
  });

  it('documento due_diligence continua sem efeito, herdado ou não', () => {
    const g = findEffectiveGrant([grant({ folder_id: 'raiz' })], 'd1', 'sum', PESSOAS, ARVORE);
    expect(computeCellEffect(g, NOW, 'due_diligence')).toBe('no_effect_private');
  });
});
