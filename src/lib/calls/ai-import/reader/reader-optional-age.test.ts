// Prompt 917 fixes (16/10/2026, from the import of the INNOV-ID form): a deadline for a document only when THAT question's text states one; optional when the text says so ("se
// aplicável", "caso considere útil", "outros documentos que considere relevantes", "if applicable"…); and a presentation in PowerPoint also takes PDF.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readForm } from './read-form';
import { OPTIONAL_CUE, explicitDocumentAgeMonths } from './cues';
import { extractDocument } from '../extract';

const read = (text: string) => readForm([{ pages: [text] }]);
const by = (r: ReturnType<typeof readForm>, n: string) => r.fields.find((f) => f.number === n)!;

describe('the age of a document: only when the question says it outright', () => {
  it('"issued less than 3 months ago" and its relatives, in Portuguese and English, in months', () => {
    const cases: [string, number][] = [
      ['Certidão permanente emitida há menos de 3 meses', 3],
      ['Declaração emitida há menos de 30 dias', 1],
      ['Documento datado nos últimos 6 meses', 6],
      ['Certidão com data inferior a 12 meses', 12],
      ['Certificate issued within the last 2 months', 2],
      ['Statement issued less than 90 days ago', 3],
      ['A letter not older than 1 year', 12],
      ['The document must be less than 6 months old', 6],
    ];
    for (const [text, months] of cases) expect(explicitDocumentAgeMonths(text), text).toBe(months);
  });
  it('"atualizada" / "up to date" on its own is NOT a deadline; neither is a period the CONTENT covers', () => {
    for (const text of ['Acesso à certidão permanente atualizada', 'Declaração atualizada', 'An up-to-date certificate', 'Demonstrações financeiras dos últimos 3 anos', 'Empresa com menos de 5 anos', 'Últimas demonstrações financeiras']) {
      expect(explicitDocumentAgeMonths(text), text).toBeNull();
    }
  });

  it('in the form: no deadline unless the question\'s own text gives one — and it never moves to another question', () => {
    const r = read(`6. Anexos\n6.1 Anexe a certidão permanente emitida há menos de 3 meses\n6.2 Anexe o plano de negócios\n6.3 Anexe a declaração de não dívida atualizada`);
    expect(by(r, '6.1').maxAgeMonths).toBe(3);
    expect(by(r, '6.2').maxAgeMonths).toBeNull();
    expect(by(r, '6.3').maxAgeMonths).toBeNull();
    // "atualizada" becomes a note for the person to confirm, saying that nothing was set
    const note = r.attention.find((a) => a.what.startsWith('6.3'));
    expect(note).toMatchObject({ kind: 'done' });
    expect(note?.why).toContain('No deadline is written, so none was set');
  });

  it('a list of documents: the deadline of one line stays with that line (and the intro\'s never goes to the children)', () => {
    const r = read(`2. Anexos\n2.1 Se for uma empresa já constituída, inclua (se disponíveis), emitidos há menos de 6 meses:\n2.1.1 Últimas demonstrações financeiras;\n2.1.2 Declaração de não dívida emitida há menos de 3 meses;\n2.1.3 Certidão permanente atualizada`);
    expect(r.fields.map((f) => [f.number, f.maxAgeMonths])).toEqual([['2.1.1', null], ['2.1.2', 3], ['2.1.3', null]]);
    expect(r.attention.some((a) => a.what.startsWith('2.1.3'))).toBe(true);
  });
});

describe('optional, when the text says so', () => {
  it('the cues, in Portuguese and English', () => {
    const optional = [
      'Website da empresa (se aplicável)', 'Anexe, se disponíveis, as contas', 'Caso tenha, insira o link', 'Caso considere útil, anexe um vídeo', 'Outros documentos que considere relevantes',
      'Campo opcional', 'Preenchimento facultativo', 'Em caso de ter obtido financiamento, indique o valor', 'If applicable, attach the certificate', 'Optional: a link to a video',
      'Any other documents you consider relevant', 'Attach the report if available', 'You may include a letter of support', 'Name of the incubator, if any',
    ];
    for (const t of optional) expect(OPTIONAL_CUE.test(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()), t).toBe(true);
    for (const t of ['Nome da empresa', 'Qual o investimento total necessário?', 'Company name', 'Anexe o plano de negócios']) {
      expect(OPTIONAL_CUE.test(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()), t).toBe(false);
    }
  });

  const MIXED = `6. Anexos
6.1 Anexe o plano de negócios
6.2 Outros documentos que considere relevantes para a análise do projeto
6.3 Caso considere útil, anexe uma apresentação em formato powerpoint
6.4 Campo opcional: website da empresa
6.5 Attach any other documents (if applicable)
6.6 Em caso de ter obtido financiamento, qual o valor?`;
  it('each of them makes the question optional; the others stay required', () => {
    const r = read(MIXED);
    expect(r.fields.map((f) => [f.number, f.required])).toEqual([['6.1', true], ['6.2', false], ['6.3', false], ['6.4', false], ['6.5', false], ['6.6', false]]);
  });
  it('"other documents" is a file that takes several, and is optional even without an explicit cue', () => {
    const r = read('6. Anexos\n6.1 Anexe o plano de negócios\n6.2 Outros documentos\n6.3 Anexe a apresentação');
    expect(by(r, '6.2')).toMatchObject({ kind: 'file', required: false, validations: { maxFiles: 10 } });
  });
  it('a question that says it is mandatory stays required whatever else it says', () => {
    expect(by(read('1. A\n1.1 Website da empresa (opcional, mas obrigatório para startups)\n1.2 Nome\n1.3 Morada'), '1.1').required).toBe(true);
  });
});

describe('a presentation in PowerPoint also takes PDF; a spreadsheet does not', () => {
  it('"apresentação"/"pitch deck"/"presentation" asked in PowerPoint -> PowerPoint and PDF; Excel stays Excel', () => {
    const r = read('6. Anexos\n6.1 Inclua uma apresentação do projeto em formato powerpoint\n6.2 Inclua o pitch deck em PowerPoint\n6.3 Inclua o plano financeiro em formato excel\n6.4 Attach your presentation as a PowerPoint file');
    expect(by(r, '6.1').validations?.fileFormats).toEqual(['pdf', 'powerpoint']);
    expect(by(r, '6.2').validations?.fileFormats).toEqual(['pdf', 'powerpoint']);
    expect(by(r, '6.3').validations?.fileFormats).toEqual(['excel']);
    expect(by(r, '6.4').validations?.fileFormats).toEqual(['pdf', 'powerpoint']);
  });
});

const REAL = process.env.INNOV_ID_PDF ?? 'C:/Users/Alexandra/Downloads/Formulário_2edCall-INNOV-ID_PT_Final-2.pdf';
describe.skipIf(!fs.existsSync(REAL))('the real INNOV-ID form', () => {
  it('no file question gets a deadline (the document states none), 6.6 is optional, and the required count is what the document allows', async () => {
    const doc = await extractDocument('f.pdf', fs.readFileSync(REAL));
    if (!doc.ok || !doc.pageTexts) throw new Error('could not read the PDF');
    const r = readForm([{ pages: doc.pageTexts }]);
    const files = r.fields.filter((f) => f.kind === 'file');
    expect(files).toHaveLength(7);
    expect(files.every((f) => f.maxAgeMonths === null)).toBe(true);
    expect(by(r, '6.6')).toMatchObject({ required: false, kind: 'file' });
    expect(by(r, '6.1').validations?.fileFormats).toEqual(['pdf', 'powerpoint']);
    expect(by(r, '2.3').required).toBe(false);
    expect(by(r, '4.2').required).toBe(false);                                   // "Em caso de ter obtido financiamento…"
    expect(r.fields.filter((f) => f.required).length).toBe(45);
    // the note that "atualizada" is not a deadline: for the access code of 6.5.3 only
    expect(r.attention.filter((a) => /up to date/.test(a.what)).map((a) => a.what)).toEqual(['6.5.3 says the document must be up to date']);
  });
});
