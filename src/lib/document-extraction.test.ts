import { describe, expect, it } from 'vitest';
import { rawExtractionToData, extractionToFacts, programFacts, rawExtractionToSummary } from './document-extraction';

describe('rawExtractionToData — nunca confia cegamente na forma devolvida pelo modelo', () => {
  it('mapeia um extraction bem formado', () => {
    const raw = {
      document_type: 'grant agreement',
      named_entities: [{ name: 'Carla Dias', kind: 'person', page: 1 }],
      programs: [{ name: 'WomenTechEU', page: 1 }],
      dates: [{ label: 'signed', date: '2022-06-01', page: 2 }],
      amounts: [{ amount: 75000, currency: 'EUR', label: 'grant', page: 3 }],
      document_reference: '101114524',
      is_signed: true,
    };
    const data = rawExtractionToData(raw, 30, 125);
    expect(data.documentType).toBe('grant agreement');
    expect(data.namedEntities).toEqual([{ name: 'Carla Dias', kind: 'person', page: 1 }]);
    expect(data.programs).toEqual([{ name: 'WomenTechEU', page: 1 }]);
    expect(data.dates).toEqual([{ label: 'signed', date: '2022-06-01', page: 2 }]);
    expect(data.amounts).toEqual([{ amount: 75000, currency: 'EUR', label: 'grant', page: 3 }]);
    expect(data.documentReference).toBe('101114524');
    expect(data.isSigned).toBe(true);
    expect(data.pagesRead).toBe(30);
    expect(data.totalPages).toBe(125);
    expect(data.partial).toBe(true);
  });

  it('partial é false quando pagesRead cobre o documento inteiro', () => {
    const data = rawExtractionToData({ document_type: 'invoice', named_entities: [], programs: [], dates: [], amounts: [] }, 5, 5);
    expect(data.partial).toBe(false);
  });

  it('nunca rebenta com um raw vazio, null, ou malformado', () => {
    expect(() => rawExtractionToData(null, 1, 1)).not.toThrow();
    expect(() => rawExtractionToData(undefined, 1, 1)).not.toThrow();
    expect(() => rawExtractionToData({}, 1, 1)).not.toThrow();
    expect(() => rawExtractionToData('not an object', 1, 1)).not.toThrow();
    expect(rawExtractionToData({}, 1, 1)).toMatchObject({ documentType: null, namedEntities: [], programs: [], dates: [], amounts: [] });
  });

  it('descarta itens de array com campos obrigatórios em falta ou de tipo errado, sem rebentar', () => {
    const raw = {
      document_type: 'x',
      named_entities: [{ name: 'Ok Person', kind: 'person' }, { kind: 'person' }, { name: 'Bad Kind', kind: 'alien' }, null],
      programs: [{ name: 'Real Program' }, { page: 3 }],
      dates: [{ label: 'ok', date: '2022' }, { label: 'missing date' }],
      amounts: [{ amount: 100, currency: 'EUR' }, { amount: 'not a number', currency: 'EUR' }],
    };
    const data = rawExtractionToData(raw, 1, 1);
    expect(data.namedEntities).toEqual([{ name: 'Ok Person', kind: 'person', page: null }]);
    expect(data.programs).toEqual([{ name: 'Real Program', page: null }]);
    expect(data.dates).toEqual([{ label: 'ok', date: '2022', page: null }]);
    expect(data.amounts).toEqual([{ amount: 100, currency: 'EUR', label: null, page: null }]);
  });

  it('page ausente ou não-numérico vira null, nunca NaN ou undefined', () => {
    const data = rawExtractionToData({ document_type: 'x', named_entities: [], programs: [{ name: 'P', page: 'three' }], dates: [], amounts: [] }, 1, 1);
    expect(data.programs[0].page).toBeNull();
  });
});

describe('rawExtractionToData — Prompt 459 §B: pitch_problem/pitch_solution', () => {
  it('mapeia pitch_problem/pitch_solution quando o documento é material de pitch', () => {
    const data = rawExtractionToData({
      document_type: 'pitch deck one-pager', named_entities: [], programs: [], dates: [], amounts: [],
      pitch_problem: 'Founders waste months chasing investors who were never a fit.',
      pitch_solution: 'We match founders to investors by real sector and stage fit.',
    }, 1, 1);
    expect(data.pitchProblem).toBe('Founders waste months chasing investors who were never a fit.');
    expect(data.pitchSolution).toBe('We match founders to investors by real sector and stage fit.');
  });

  it('um documento sem conteúdo de pitch (ex.: certificado) nunca inventa pitchProblem/pitchSolution — omissão vira null', () => {
    const data = rawExtractionToData({ document_type: 'certificate', named_entities: [], programs: [], dates: [], amounts: [] }, 1, 1);
    expect(data.pitchProblem).toBeNull();
    expect(data.pitchSolution).toBeNull();
  });

  it('string vazia ou só espaços vira null, nunca uma string vazia guardada', () => {
    const data = rawExtractionToData({
      document_type: 'x', named_entities: [], programs: [], dates: [], amounts: [], pitch_problem: '   ', pitch_solution: '',
    }, 1, 1);
    expect(data.pitchProblem).toBeNull();
    expect(data.pitchSolution).toBeNull();
  });

  it('um valor não-string (o modelo não respeitou o schema) vira null, nunca rebenta', () => {
    const data = rawExtractionToData({
      document_type: 'x', named_entities: [], programs: [], dates: [], amounts: [], pitch_problem: 42, pitch_solution: ['not', 'a', 'string'],
    }, 1, 1);
    expect(data.pitchProblem).toBeNull();
    expect(data.pitchSolution).toBeNull();
  });

  it('corta em limite de palavra a INTRO_PITCH_MAX (240), nunca a meio de uma palavra', () => {
    const longProblem = 'word '.repeat(60).trim(); // 60*5-1 = 299 chars, well past 240
    const data = rawExtractionToData({
      document_type: 'pitch deck', named_entities: [], programs: [], dates: [], amounts: [], pitch_problem: longProblem,
    }, 1, 1);
    expect(data.pitchProblem).not.toBeNull();
    expect(data.pitchProblem!.length).toBeLessThanOrEqual(240 + 1); // +1 for the trailing '…'
    expect(data.pitchProblem!.endsWith('…')).toBe(true);
    expect(data.pitchProblem).not.toContain('wor…'); // never a mid-word cut when a space exists within the limit
  });
});

describe('extractionToFacts / programFacts — o pool de comparação para a ligação a claims', () => {
  const extraction = rawExtractionToData({
    document_type: 'grant agreement',
    named_entities: [{ name: 'Carla Dias', kind: 'person', page: 1 }],
    programs: [{ name: 'WomenTechEU', page: 1 }],
    dates: [], amounts: [],
  }, 30, 30);

  it('extractionToFacts combina programs E named_entities', () => {
    const facts = extractionToFacts(extraction, 'doc-1', 'Grant Agreement.pdf');
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.label).sort()).toEqual(['Carla Dias', 'WomenTechEU']);
    expect(facts.every((f) => f.documentId === 'doc-1' && f.documentName === 'Grant Agreement.pdf')).toBe(true);
  });

  it('programFacts inclui só programs — uma entidade nomeada sozinha nunca justifica um claim novo', () => {
    const facts = programFacts(extraction, 'doc-1', 'Grant Agreement.pdf');
    expect(facts).toEqual([{ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 1, label: 'WomenTechEU' }]);
  });
});

describe('rawExtractionToSummary — Prompt 355, the second output of the same tool call', () => {
  it('extracts a well-formed summary and highlights', () => {
    const out = rawExtractionToSummary({ summary: 'This is a signed grant agreement.', highlights: ['€75,000 grant', 'Signed 2022-06-01'] });
    expect(out).toEqual({ summary: 'This is a signed grant agreement.', highlights: ['€75,000 grant', 'Signed 2022-06-01'] });
  });

  it('never trusts the model blindly — missing/malformed fields become null/empty, never throw', () => {
    expect(rawExtractionToSummary({})).toEqual({ summary: null, highlights: [] });
    expect(rawExtractionToSummary(null)).toEqual({ summary: null, highlights: [] });
    expect(rawExtractionToSummary({ summary: 42, highlights: 'not an array' })).toEqual({ summary: null, highlights: [] });
  });

  it('drops blank/whitespace-only highlight entries', () => {
    const out = rawExtractionToSummary({ summary: 'x', highlights: ['real one', '   ', ''] });
    expect(out.highlights).toEqual(['real one']);
  });

  it('caps highlights at 3, even if the model returns more', () => {
    const out = rawExtractionToSummary({ summary: 'x', highlights: ['a', 'b', 'c', 'd', 'e'] });
    expect(out.highlights).toHaveLength(3);
  });

  it('treats an empty-string summary as null, not an empty-but-present value', () => {
    expect(rawExtractionToSummary({ summary: '   ', highlights: [] }).summary).toBeNull();
  });
});
