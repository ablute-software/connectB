// Prompt 917 (Adenda 1, Part B) — the platform's own reader of forms: what it makes of numbered forms in Portuguese and English, how it measures itself, and what that decides.
// Includes the REAL INNOV-ID form (the PDF the Nuno used) when it is on this machine: the reader alone must read sections 1 to 6, the yes/nos, the choices and the "Se sim" follow-ups.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { readForm } from './read-form';
import { READER_THRESHOLDS, aiParts, decide } from './decide';
import { readTemplateTable } from './table';
import { extractDocument } from '../extract';
import { fieldItemsToFormFields, sanitizeFieldItems } from '../proposal';
import { parseFieldsPayload } from '../../form-builder';

const read = (text: string) => readForm([{ pages: [text] }]);
const by = (r: ReturnType<typeof readForm>, num: string) => r.fields.find((f) => f.number === num)!;

const MINI = `
1. Dados da candidatura
1.1 Nome do responsável pelo contato
1.2 Endereço de e-mail
1.3 Este projeto está incubado? (Sim ou Não)
1.3.1 Se sim, qual a incubadora?
1.4 Em que setor se insere? (selecione)
- Saúde;
- Energia
- Turismo
1.5 Que apoios pretende? (selecione todos os que se aplicam)
- Financiamento
- Mentoria
1.6 Quantos fundadores tem a empresa?
1.7 Data de constituição da empresa
1.8 Descreva o produto (máximo 500 palavras)
1.9 Website da empresa (se aplicável)
2. Anexos
2.1 Anexe o plano de negócios em formato excel
2.2 Outros documentos relevantes
`;

describe('what it reads', () => {
  const r = read(MINI);
  it('numbered items become questions, the top-level numbers become the pages', () => {
    expect(r.fields.map((f) => f.number)).toEqual(['1.1', '1.2', '1.3', '1.3.1', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.1', '2.2']);
    expect(r.fields.filter((f) => f.page === 1)).toHaveLength(10);
    expect(r.fields.filter((f) => f.page === 2)).toHaveLength(2);
    expect(r.sections.map((s) => [s.number, s.title])).toEqual([['1', 'Dados da candidatura'], ['2', 'Anexos']]);
  });
  it('recognises the kinds by what the text says, in the order of the clearest evidence', () => {
    const k = (n: string) => by(r, n).kind;
    expect([k('1.1'), k('1.2'), k('1.3'), k('1.4'), k('1.5'), k('1.6'), k('1.7'), k('1.8'), k('1.9'), k('2.1'), k('2.2')]).toEqual(
      ['short_text', 'email', 'yes_no', 'single_choice', 'multiple_choice', 'number', 'date', 'long_text', 'url', 'file', 'file']);
  });
  it('options come from bullets (the trailing ; is dropped), a single list is single choice, "select all" is multiple', () => {
    expect(by(r, '1.4').options).toEqual(['Saúde', 'Energia', 'Turismo']);
    expect(by(r, '1.5').options).toEqual(['Financiamento', 'Mentoria']);
  });
  it('"Se sim" is a follow-up shown only if the previous yes/no is Yes; the yes/no cue is taken out of the label', () => {
    const f = by(r, '1.3.1'); const parent = by(r, '1.3');
    expect(f.condition).toEqual({ tmpId: parent.tmpId, value: 'yes' });
    expect(parent.label).toBe('1.3 Este projeto está incubado?');
  });
  it('"(se aplicável)" and the like are optional; a question is required unless the document says it is not', () => {
    expect(by(r, '1.9').required).toBe(false);
    expect(by(r, '1.1').required).toBe(true);
  });
  it('a File says which formats it takes; "other documents" takes several', () => {
    expect(by(r, '2.1').validations).toMatchObject({ fileFormats: ['excel'] });
    expect(by(r, '2.2').validations).toMatchObject({ maxFiles: 10 });
  });
  it('is read the same in English', () => {
    const en = read(`1. About you\n1.1 Company name\n1.2 Contact e-mail\n1.3 Are you incorporated? (Yes or No)\n1.3.1 If yes, in which country?\n1.4 How many people work in the team?\n1.5 Link to a video of the pitch (optional)\n1.6 Please attach your pitch deck as a PowerPoint file`);
    expect(en.fields.map((f) => f.kind)).toEqual(['short_text', 'email', 'yes_no', 'short_text', 'number', 'url', 'file']);
    expect(by(en, '1.3.1').condition).toMatchObject({ value: 'yes' });
    expect(by(en, '1.5').required).toBe(false);
    expect(by(en, '1.6').validations).toMatchObject({ fileFormats: ['pdf', 'powerpoint'] });
  });
});

describe('what it solves, and says it did', () => {
  it('a yes/no and an amount in one question become two, the amount only if Yes', () => {
    const r = read(`1. Investment\n1.1 Os promotores estão disponíveis para investir neste projeto?\nSim ou não. Quanto (em euros)?\n1.2 Nome`);
    expect(r.fields.map((f) => [f.number, f.kind])).toEqual([['1.1', 'yes_no'], ['1.1/2', 'number'], ['1.2', 'short_text']]);
    expect(r.fields[1].condition).toEqual({ tmpId: r.fields[0].tmpId, value: 'yes' });
    expect(r.fields[1].validations).toMatchObject({ currency: true });
    expect(r.attention.map((a) => a.what)).toContain('1.1 asked a yes/no and an amount');
  });
  it('a yes/no with its follow-up in the same line becomes two questions', () => {
    const r = read(`1. Team\n1.1 Já apresentou uma candidatura anterior? Se sim, qual?\n1.2 Nome`);
    expect(r.fields.map((f) => [f.number, f.kind])).toEqual([['1.1', 'yes_no'], ['1.1/2', 'short_text'], ['1.2', 'short_text']]);
    expect(r.fields[1].condition).toMatchObject({ value: 'yes' });
  });
  it('a document with "the following topics" keeps the topics as its instruction, not as questions', () => {
    const r = read(`6. Anexos\n6.1 Inclua uma apresentação em formato powerpoint, a qual deverá abordar os seguintes tópicos:\n6.1.1 Equipa de gestão;\n6.1.2 Mercado;\n6.1.3 Modelo de negócio;\n6.2 Nome`);
    expect(r.fields.map((f) => f.number)).toEqual(['6.1', '6.2']);
    expect(by(r, '6.1').instruction).toContain('Equipa de gestão');
    expect(by(r, '6.1').validations).toMatchObject({ fileFormats: ['pdf', 'powerpoint'] });
    expect(r.attention.map((a) => a.what)).toContain('6.1 lists 3 topics for the document');
  });
  it('CVs "of each member" and a list of data per person: one "Team member" group with a CV in each entry — never a ZIP', () => {
    const r = read(`6. Anexos\n6.4 Inclua um breve currículo de cada promotor em formato zipado\n6.4.1 Nome, idade, cargo, habilitações literárias, experiência profissional e e-mail;\n6.4.2 Nome`);
    const g = by(r, '6.4');
    expect(g.kind).toBe('group');
    expect(g.group?.entryLabel).toBe('Team member');
    expect(g.group?.subFields.map((s) => [s.label, s.kind])).toEqual([['Nome', 'short_text'], ['Idade', 'number'], ['Cargo', 'short_text'], ['Habilitações literárias', 'short_text'], ['Experiência profissional', 'long_text'], ['E-mail', 'email'], ['CV', 'file']]);
    expect(g.group?.subFields[6].validations.fileFormats).toEqual(['pdf']);
    expect(r.fields.map((f) => f.number)).toEqual(['6.4', '6.4.2']);                          // 6.4.1 became the group's questions
    expect(r.attention.find((a) => a.what.startsWith('6.4'))?.why).toContain('a ZIP is not accepted');
  });
  it('"please include (if available):" and a list of documents: one file question per document; an access code is text', () => {
    const r = read(`2. Anexos\n2.1 Se for uma empresa já constituída, inclua (se disponíveis):\n2.1.1 Últimas demonstrações financeiras;\n2.1.2 Acesso à certidão permanente atualizada;\n2.1.3 Declaração de não dívida`);
    expect(r.fields.map((f) => [f.number, f.kind, f.required])).toEqual([['2.1.1', 'file', false], ['2.1.2', 'short_text', false], ['2.1.3', 'file', false]]);
    expect(r.attention.find((a) => a.what === '2.1 asked for 3 documents')?.why).toContain('2 file questions and 1 text question');
  });
  it('the options of a pipe list — inline, after "(selecionar)", or in a parenthesis with a prefix — are read; "Região Autónoma …, Região Autónoma …" is split', () => {
    const r = read(`1. Perfil\n1.1 Há quanto tempo criou a empresa? (selecionar) Não constituída | <1 ano| <3 anos| 3-5\nanos| 6-8 anos|\n1.2 Região (NUTs III: Alto Minho |Cávado | Ave|\nRegião Autónoma dos Açores, Região Autónoma da Madeira)\n1.3 Nome`);
    expect(by(r, '1.1').options).toEqual(['Não constituída', '<1 ano', '<3 anos', '3-5 anos', '6-8 anos']);
    expect(by(r, '1.2').options).toEqual(['Alto Minho', 'Cávado', 'Ave', 'Região Autónoma dos Açores', 'Região Autónoma da Madeira']);
    // and the age brackets of the company are flagged as possibly out of date
    expect(r.attention.some((a) => a.kind === 'outdated' && a.what.startsWith('1.1'))).toBe(true);
  });
  it('repeated headers and page numbers are not questions; the title that repeats on every page names the call', () => {
    const page = (n: number) => `Application Form\nINNOV-ID\n${n}\n${n}. Secção\n${n}.1 Nome\n${n}.2 Morada`;
    const r = readForm([{ pages: [page(1), page(2), page(3)] }]);
    expect(r.general.name).toBe('INNOV-ID');
    expect(r.fields.every((f) => !/Application Form|INNOV-ID/.test(f.label))).toBe(true);
    expect(r.fields).toHaveLength(6);
  });
});

describe('a template table with numbered columns', () => {
  const block = { title: 'Exemplo - template Competitive Detailed Analysis', text: `Exemplo - template Competitive Detailed Analysis\nCaso considerar útil, poderá utilizar o template infra.\nRelevant Criteria Your solution/\ncompany Competitor #1 Competitor #2 Competitor #...\nProducts\n& Services\nBusiness Model\nTarget\nMarket (size in\n€, identifying\nmarkets)\nMarket Share (%)\nCompetitive\nadvantage\n...` };
  it('becomes a group shown as a table: the companies are the fixed rows, the criteria the columns', () => {
    const t = readTemplateTable(block)!;
    expect(t.title).toBe('Competitive Detailed Analysis');
    expect(t.group.display).toBe('table');
    expect(t.group.presetRows).toEqual([['Your solution/company'], ['Competitor #1'], ['Competitor #2']]);
    expect(t.group.subFields.map((s) => s.label)).toEqual(['Company', 'Products & Services', 'Business Model', 'Target Market (size in €, identifying markets)', 'Market Share (%)', 'Competitive advantage']);
    expect([t.group.min, t.group.max]).toEqual([3, 3]);
  });
  it('a block that is not that shape stays unresolved, with the place it follows', () => {
    expect(readTemplateTable({ title: 'Quadro de custos', text: 'Quadro de custos\nitem valor\nalgo 10' })).toBeNull();
    const r = read(`1. Perfil\n1.1 Nome\n1.2 Morada\n1.3 Cidade\nQuadro de custos previstos\nrubrica | 2026 | 2027\nequipa | 10 | 12`);
    expect(r.quality.unresolved.map((u) => [u.title, u.afterNumber])).toEqual([['Quadro de custos previstos', '1.3']]);
  });
});

describe('how it measures itself, and what that decides', () => {
  it('a clean form is read on its own: full coverage, clear types, nothing unresolved -> internal', () => {
    const r = read(MINI);
    expect(r.quality.coverage).toBeGreaterThanOrEqual(READER_THRESHOLDS.coverage);
    expect(r.quality.typeConfidence).toBeGreaterThanOrEqual(READER_THRESHOLDS.typeConfidence);
    expect(decide(r.quality)).toEqual({ mode: 'internal', reasons: [] });
    expect(aiParts(r, decide(r.quality))).toEqual([]);
  });
  it('a structure it cannot read -> internal + AI, and the AI is given only that part (and where it goes)', () => {
    const r = read(`1. Perfil\n1.1 Nome\n1.2 Morada\n1.3 Cidade\nQuadro de custos previstos\nrubrica | 2026 | 2027\nequipa | 10 | 12`);
    const d = decide(r.quality);
    expect(d.mode).toBe('internal+ai');
    expect(d.reasons[0]).toContain('Quadro de custos previstos');
    const parts = aiParts(r, d);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'block', afterNumber: '1.3' });
    expect(parts[0].text).toContain('equipa | 10 | 12');
    expect(parts[0].text).not.toContain('Morada');
  });
  it('questions whose kind is a guess (not a clear rule) go to the AI only when too many are — below 80% — and then only those', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `1.${i + 1} Os senhores concordam com o ponto ${i + 1}?`).join('\n');
    const r = read(`1. Perfil\n${lines}\n1.11 Nome`);
    expect(r.quality.weak).toHaveLength(10);
    const d = decide(r.quality);
    expect(d.mode).toBe('internal+ai');
    const parts = aiParts(r, d);
    expect(parts[0].kind).toBe('items');
    expect(parts[0].numbers).toHaveLength(10);
    expect(parts[0].text).not.toContain('1.11 Nome');
  });
  it('a text with no numbered structure the reader understands goes whole to the AI (coverage below 60%)', () => {
    const r = read('Dear applicant, please tell us about your company and why you want to apply to this programme. We will read everything.');
    expect(decide(r.quality).mode).toBe('ai');
    expect(decide(read('').quality).mode).toBe('ai');
  });
  it('a form with NO numbering is read by its lines that end in "?" or ":" — and a table in it still sends only the table to the AI', () => {
    const r = read(`Tell us about your company.\nWhat is the name of the company?\nAre you incorporated? (Yes or No)\nHow many people work with you?\nContact e-mail:\nCompetitor table\nMetric | You | Competitor A | Competitor B\nPrice | 10 | 12 | 9`);
    expect(r.fields.map((f) => f.kind)).toEqual(['short_text', 'yes_no', 'number', 'email']);
    expect(r.fields.every((f) => f.number === null)).toBe(true);
    const d = decide(r.quality);
    expect(d.mode).toBe('internal+ai');
  });
  it('the thresholds are one constant: coverage 95%, types 80%, the whole text only below 60%', () => {
    expect(READER_THRESHOLDS).toEqual({ coverage: 0.95, typeConfidence: 0.8, wholeDocumentBelow: 0.6 });
  });
});

// --- The real form --------------------------------------------------------------------------------------------------------------------------------------------
const REAL = process.env.INNOV_ID_PDF ?? 'C:/Users/Alexandra/Downloads/Formulário_2edCall-INNOV-ID_PT_Final-2.pdf';
describe.skipIf(!fs.existsSync(REAL))('the real INNOV-ID form (the PDF the Nuno uses to test)', () => {
  it('is read by the platform ALONE: sections 1 to 6, the yes/nos, the choices, the follow-ups — no AI', async () => {
    const doc = await extractDocument('f.pdf', fs.readFileSync(REAL));
    expect(doc.ok && doc.pageTexts?.length).toBe(6);
    if (!doc.ok || !doc.pageTexts) return;
    const r = readForm([{ pages: doc.pageTexts }]);
    const q = r.quality;
    // the numbers that go in the report
    expect({ coverage: q.coverage, typeConfidence: Math.round(q.typeConfidence * 100) / 100, unresolved: q.unresolved.length, questions: q.questions }).toMatchObject({ coverage: 1, unresolved: 0 });
    expect(q.typeConfidence).toBeGreaterThanOrEqual(READER_THRESHOLDS.typeConfidence);
    expect(decide(q)).toEqual({ mode: 'internal', reasons: [] });
    expect(r.general.name).toBe('INNOV-ID');
    expect(r.sections.map((s) => s.number)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(r.fields.length).toBeGreaterThanOrEqual(54);

    expect(by(r, '1.2').kind).toBe('email');
    for (const n of ['1.4', '1.5', '2.10', '3.1', '3.2', '3.3', '3.4', '3.5', '5.4']) expect(by(r, n).kind, n).toBe('yes_no');
    expect(by(r, '2.2')).toMatchObject({ kind: 'single_choice', options: ['Digital & Tecnologia', 'Indústria & Tecnologia', 'Tecnologias da Saúde', 'Turismo Tecnológico'] });
    expect(by(r, '2.10.1')).toMatchObject({ kind: 'single_choice' });
    expect(by(r, '2.10.1').options).toHaveLength(7);
    expect(by(r, '2.10.2').options).toEqual(['Não constituída', '<1 ano', '<3 anos', '3-5 anos', '6-8 anos']);
    expect(by(r, '2.10.3').kind).toBe('date');
    for (const n of ['1.5.1', '2.10.1', '3.1.1', '3.2.1']) expect(by(r, n).condition?.value, n).toBe('yes');
    expect(by(r, '1.5.1').condition?.tmpId).toBe(by(r, '1.5').tmpId);
    expect(by(r, '2.3')).toMatchObject({ kind: 'url', required: false });
    expect(by(r, '3.3.1').kind).toBe('number');
    expect(by(r, '3.6').kind).toBe('long_text');
    expect(by(r, '4.3')).toMatchObject({ kind: 'number', validations: { currency: true } });
    expect(by(r, '4.4').kind).toBe('yes_no');
    expect(by(r, '4.4/2')).toMatchObject({ kind: 'number', condition: { tmpId: by(r, '4.4').tmpId, value: 'yes' } });
    expect(by(r, '6.1')).toMatchObject({ kind: 'file', validations: { fileFormats: ['pdf', 'powerpoint'] } });
    expect(by(r, '6.1').instruction).toContain('Equipa de gestão');
    expect(by(r, '6.2').validations).toMatchObject({ fileFormats: ['excel'] });
    expect(by(r, '6.3')).toMatchObject({ kind: 'url', required: false, validations: { urlHint: 'video' } });
    expect(by(r, '6.4')).toMatchObject({ kind: 'group' });
    expect(by(r, '6.4').group?.subFields.map((s) => s.kind)).toEqual(['short_text', 'number', 'short_text', 'short_text', 'long_text', 'email', 'file']);
    expect(by(r, '6.4.2/2').condition?.value).toBe('yes');
    expect(['6.5.1', '6.5.2', '6.5.4'].map((n) => by(r, n).kind)).toEqual(['file', 'file', 'file']);
    expect(by(r, '6.5.3').kind).toBe('short_text');                                           // the access code is text
    expect(by(r, '6.6').validations).toMatchObject({ maxFiles: 10 });
    expect(by(r, '6.7').kind).toBe('file');
    const table = r.fields[r.fields.length - 1];
    expect(table).toMatchObject({ kind: 'group', label: 'Competitive Detailed Analysis' });
    expect(table.group?.presetRows).toHaveLength(3);
    expect(table.group?.subFields).toHaveLength(6);
    // nothing is said twice: one warning per question number
    const nums = r.attention.map((a) => a.what.match(/^\d+(?:\.\d+)*/)?.[0]).filter(Boolean);
    expect(new Set(nums).size).toBe(nums.length);
    expect(r.attention.some((a) => a.kind === 'outdated' && a.what.startsWith('2.10.2'))).toBe(true);        // the age brackets: legitimate, and kept
  });

  it('what it made is a valid call form: it survives the sanitiser and the editor\'s own check, conditions and groups included', async () => {
    const doc = await extractDocument('f.pdf', fs.readFileSync(REAL));
    if (!doc.ok || !doc.pageTexts) return;
    const r = readForm([{ pages: doc.pageTexts }]);
    const clean = sanitizeFieldItems(r.fields, { paged: false, source: 'internal' });
    expect(clean.fields).toHaveLength(r.fields.length);
    expect(clean.fields.filter((f) => f.condition)).toHaveLength(r.fields.filter((f) => f.condition).length);
    const formFields = fieldItemsToFormFields(clean.fields, 0);
    const parsed = parseFieldsPayload(formFields);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (parsed.ok) {
      expect(parsed.fields.filter((f) => f.kind === 'group')).toHaveLength(2);
      expect(parsed.fields.filter((f) => f.condition).length).toBeGreaterThanOrEqual(9);
    }
  });
});
