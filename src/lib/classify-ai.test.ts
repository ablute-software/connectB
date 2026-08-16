import { describe, expect, it } from 'vitest';
import { buildClassifyPrompt, parseClassifyResponse, aiNeedsReview, CLASSIFY_MODEL_DEFAULT } from './classify-ai';

// Prompt 208 §D.2 — o caso de teste real é a resposta da Adara Ventures.
const ADARA = [
  'Dear Nuno,',
  'Thank you for getting in touch with us through our website. After reviewing and debating internally the information you uploaded, we have decided not to pursue a potential investment. We thank you for thinking of Adara as a possible investor and wish you the best for your fundraising process.',
  'Sincerely,',
  'Alexei Perley',
].join('\n');

describe('buildClassifyPrompt', () => {
  it('leva o conteudo literal', () => {
    expect(buildClassifyPrompt(ADARA)).toContain('not to pursue');
  });

  it('proibe inventar razao que nao esteja no texto', () => {
    const p = buildClassifyPrompt(ADARA);
    expect(p).toContain('Never invent a reason');
    expect(p).toContain('quoted from the text');
  });

  it('explica os valores que se confundem', () => {
    const p = buildClassifyPrompt('...');
    expect(p).toContain('however politely it is written');
  });
});

describe('parseClassifyResponse', () => {
  it('le a resposta esperada para a Adara', () => {
    const raw = JSON.stringify({
      classification: 'pass', passReasonCategory: 'thesis_mismatch',
      passReason: 'decided not to pursue a potential investment',
    });
    expect(parseClassifyResponse(raw)).toEqual({
      classification: 'pass', passReasonCategory: 'thesis_mismatch',
      passReason: 'decided not to pursue a potential investment',
    });
  });

  it('aguenta cercas de codigo e texto a volta', () => {
    const raw = 'Here you go:\n```json\n{"classification":"interested"}\n```\nHope that helps.';
    expect(parseClassifyResponse(raw)).toEqual({ classification: 'interested' });
  });

  // O ponto: preferimos NAO sugerir a sugerir uma classificacao inventada.
  it('rejeita um valor fora da lista em vez de o aproximar', () => {
    expect(parseClassifyResponse('{"classification":"rejected"}')).toBeNull();
    expect(parseClassifyResponse('{"classification":"PASS"}')).toBeNull();
  });

  it('rejeita lixo sem lancar', () => {
    expect(parseClassifyResponse('')).toBeNull();
    expect(parseClassifyResponse('nao e json nenhum')).toBeNull();
    expect(parseClassifyResponse('{ partido')).toBeNull();
  });

  it('pass sem categoria valida cai em "other", nao e rejeitado', () => {
    const r = parseClassifyResponse('{"classification":"pass","passReasonCategory":"inventada","passReason":"x"}');
    expect(r?.passReasonCategory).toBe('other');
  });

  it('pass sem razao nenhuma fica com razao vazia -- nao se inventa', () => {
    const r = parseClassifyResponse('{"classification":"pass"}');
    expect(r?.classification).toBe('pass');
    expect(r?.passReason).toBe('');
  });

  it('nao-pass nao arrasta campos de pass', () => {
    const r = parseClassifyResponse('{"classification":"question","passReason":"lixo"}');
    expect(r).toEqual({ classification: 'question' });
  });
});

describe('aiNeedsReview', () => {
  it('um pass por AI fica sempre por rever -- muda o status da entidade', () => {
    expect(aiNeedsReview({ classification: 'pass', passReasonCategory: 'other', passReason: 'x' })).toBe(true);
  });

  it('as outras nao', () => {
    expect(aiNeedsReview({ classification: 'interested' })).toBe(false);
    expect(aiNeedsReview({ classification: 'question' })).toBe(false);
  });
});

describe('modelo', () => {
  it('e o barato, nao o do composer', () => {
    expect(CLASSIFY_MODEL_DEFAULT).toBe('claude-haiku-4-5');
  });
});
