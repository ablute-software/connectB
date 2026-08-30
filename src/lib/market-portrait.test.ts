import { describe, expect, it } from 'vitest';
import { pickPortraitDocuments, MAX_PORTRAIT_DOCS, classifyPortraitResponse, TIMEOUT_MESSAGE, NETWORK_MESSAGE } from './market-portrait';

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

// Prompt 468 §A/§B — required tests, exercised against the pure decision
// logic (classifyPortraitResponse) and copy constants rather than a
// rendered component: this codebase has no DOM-testing infrastructure (no
// jsdom, no @testing-library, no JSX transform configured for vitest —
// importing anything from a .tsx file fails vitest's own parser), which is
// exactly why this logic lives in this plain .ts module and not inline in
// MarketPortraitCard.tsx.
describe('classifyPortraitResponse — the unreadable-response case (Prompt 468 §A/§B)', () => {
  it('body === null (res.json() rejected) classifies as timeout, with onDone required BEFORE the message', () => {
    const outcome = classifyPortraitResponse(null);
    expect(outcome).toEqual({ kind: 'error', buildError: { kind: 'timeout' }, callOnDoneFirst: true });
  });

  it('an ok:false response with its own error message is unaffected — still classified as "own", never as timeout', () => {
    const outcome = classifyPortraitResponse({ ok: false, error: 'Could not read your Vault.' });
    expect(outcome).toEqual({ kind: 'error', buildError: { kind: 'own', message: 'Could not read your Vault.' }, callOnDoneFirst: false });
  });

  it('an ok:false response with no error message falls back to a generic one, still "own" and still callOnDoneFirst: false', () => {
    const outcome = classifyPortraitResponse({ ok: false });
    expect(outcome).toEqual({
      kind: 'error',
      buildError: { kind: 'own', message: 'Could not build your market portrait — try again.' },
      callOnDoneFirst: false,
    });
  });

  it('an ok:true response classifies as success and carries the result through untouched', () => {
    const body = { ok: true, documentsRead: 3, costEur: 0.293, cached: false, ringsProposed: 2, ringsNote: null, competitorsProposed: 1 };
    expect(classifyPortraitResponse(body)).toEqual({ kind: 'success', result: body });
  });
});

describe('timeout copy never claims failure (Prompt 468 §A required test (a)/(c))', () => {
  it('TIMEOUT_MESSAGE does not contain the word "failed"', () => {
    expect(TIMEOUT_MESSAGE.toLowerCase()).not.toContain('failed');
  });

  it('TIMEOUT_MESSAGE and NETWORK_MESSAGE are distinct — the right text for the right case', () => {
    expect(TIMEOUT_MESSAGE).not.toBe(NETWORK_MESSAGE);
  });

  it('NETWORK_MESSAGE (unchanged case) is untouched by this prompt', () => {
    expect(NETWORK_MESSAGE).toBe('Could not reach the server — check your connection and try again.');
  });
});
