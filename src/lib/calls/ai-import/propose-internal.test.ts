// Prompt 917 (Adenda 1, Part B) — the reading of a set of documents, platform first: a form the reader understands never reaches the AI provider; a form with one part it cannot
// read sends THAT part only; with no AI available what the platform read stands (and the run says what was left); a text that is no form goes whole, as before.
import { describe, expect, it } from 'vitest';
import { proposeFromDocuments, type ModelCaller, type ModelRequest, type PreparedDoc } from './propose';
import { CORRECT_TOOL_NAME, OVERVIEW_TOOL_NAME } from './prompt';
import { IMPORT_PRIVACY_NOTICE } from './limits';

const CLEAN = `1. Perfil\n1.1 Nome do responsável\n1.2 Endereço de e-mail\n1.3 O projeto está incubado? (Sim ou Não)\n1.3.1 Se sim, qual a incubadora?\n1.4 Descreva o produto (máximo 500 palavras)\n1.5 Data de constituição`;
const WITH_TABLE = `1. Perfil\n1.1 Nome\n1.2 Morada\n1.3 Cidade\nQuadro de custos previstos\nrubrica | 2026 | 2027\nequipa | 10 | 12`;
const doc = (text: string, kind: PreparedDoc['kind'] = 'form'): PreparedDoc => ({ kind, format: 'pdf', text, pageTexts: [text], pdfBase64: null });

function recorder(answer: (req: ModelRequest) => unknown): { caller: ModelCaller; calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return { calls, caller: async (req) => { calls.push(req); return { model: 'm', usage: { input_tokens: 100, output_tokens: 50 }, input: answer(req) }; } };
}
const text = (req: ModelRequest) => JSON.stringify(req.content);

describe('a form the platform reads on its own', () => {
  it('makes no call to the AI at all: mode internal, the platform as the model, every question marked as the platform\'s', async () => {
    const p = recorder(() => { throw new Error('the AI must not be asked'); });
    const r = await proposeFromDocuments([doc(CLEAN)], { callModel: p.caller });
    expect(p.calls).toHaveLength(0);
    expect(r.meta).toMatchObject({ mode: 'internal', calls: 0, aiSections: [], aiFields: 0, aiFailed: [] });
    expect(r.meta.internalFields).toBe(r.proposal.fields.length);
    expect(r.model).toBe('platform-reader');
    expect(r.usage).toBeUndefined();
    expect(r.meta.quality).toMatchObject({ coverage: 1 });
    expect(r.proposal.fields.every((f) => f.source === 'internal')).toBe(true);
    expect(r.proposal.fields.map((f) => f.kind)).toEqual(['short_text', 'email', 'yes_no', 'short_text', 'long_text', 'date']);
    const follow = r.proposal.fields[3];
    expect(follow.condition).toEqual({ tmpId: r.proposal.fields[2].tmpId, value: 'yes' });
  });
  it('is the same on every run (no randomness, no clock)', async () => {
    const p = recorder(() => ({}));
    const a = await proposeFromDocuments([doc(CLEAN)], { callModel: p.caller });
    const b = await proposeFromDocuments([doc(CLEAN)], { callModel: p.caller });
    expect(JSON.stringify(a.proposal.fields.map(({ tmpId: _t, ...f }) => f))).toBe(JSON.stringify(b.proposal.fields.map(({ tmpId: _t, ...f }) => f)));
  });
  it('the screen tells the person the truth about it: read on the platform, only the unclear part goes to the AI provider', () => {
    expect(IMPORT_PRIVACY_NOTICE).toBe("We read your document on our platform. If a part is unclear, that part is sent to our AI provider to complete the proposal. Do not upload applicants' documents or confidential evaluation grids.");
  });
});

describe('a form with one part the platform cannot read', () => {
  const answer = (req: ModelRequest) => ({
    additions: [{ part: 'block:1', fields: [
      { label: 'Custos previstos', kind: 'group', required: true, group: { entry_label: 'Rubrica', min: 1, max: 10, display: 'table', sub_fields: [{ label: 'Rubrica', kind: 'short_text' }, { label: '2026', kind: 'number' }, { label: '2027', kind: 'number' }] } },
    ] }],
    needs_attention: [{ kind: 'done', what: 'Quadro de custos previstos', why: 'became a table group' }],
    _seen: text(req).length,
  });
  it('sends ONLY that part (its text, where it goes), not the questions the platform already read', async () => {
    const p = recorder(answer);
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: p.caller });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].tool.name).toBe(CORRECT_TOOL_NAME);
    const sent = text(p.calls[0]);
    expect(sent).toContain('equipa | 10 | 12');
    expect(sent).toContain('after question 1.3');
    expect(sent).not.toContain('Morada');
    expect(sent).not.toContain('Nome');
    expect(r.meta).toMatchObject({ mode: 'internal+ai', calls: 1 });
    expect(r.meta.aiSections).toEqual(['page 1: Quadro de custos previstos']);
    expect(r.meta.why[0]).toContain('Quadro de custos previstos');
  });
  it('puts what the AI made after the question the part follows, marked as the AI\'s; the platform\'s questions are untouched', async () => {
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: recorder(answer).caller });
    expect(r.proposal.fields.map((f) => [f.label, f.kind, f.source])).toEqual([
      ['1.1 Nome', 'short_text', 'internal'], ['1.2 Morada', 'short_text', 'internal'], ['1.3 Cidade', 'short_text', 'internal'], ['Custos previstos', 'group', 'ai'],
    ]);
    expect(r.proposal.fields[3].group).toMatchObject({ entryLabel: 'Rubrica', display: 'table' });
    expect(r.meta).toMatchObject({ internalFields: 3, aiFields: 1 });
    expect(r.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(r.proposal.attention.some((a) => a.kind === 'done')).toBe(true);
  });
  it('with no AI key, what the platform read stands and the run says what was left: no error, mode internal', async () => {
    const caller: ModelCaller = async () => { throw Object.assign(new Error('The import from documents is not available right now.'), { code: 'not_configured' }); };
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: caller });
    expect(r.proposal.fields.map((f) => f.label)).toEqual(['1.1 Nome', '1.2 Morada', '1.3 Cidade']);
    expect(r.meta.mode).toBe('internal');
    expect(r.meta.aiSections).toEqual([]);
    expect(r.meta.aiFailed[0]).toContain('not available');
    const left = r.proposal.attention.find((a) => a.what.includes('Quadro de custos previstos'));
    expect(left).toMatchObject({ kind: 'not_covered' });
    expect(left?.why).toContain('Add its questions by hand');
  });
  it('a provider that fails (not the job\'s own clock) leaves the platform\'s reading too, with the reason', async () => {
    const caller: ModelCaller = async () => { throw new Error('upstream 529'); };
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: caller });
    expect(r.proposal.fields).toHaveLength(3);
    expect(r.meta.aiFailed).toEqual(['page 1: Quadro de custos previstos: upstream 529']);
  });
  it('the job\'s own clock still stops everything', async () => {
    const stop = new AbortController();
    const caller: ModelCaller = async (req) => new Promise((_, reject) => { req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); stop.abort(); });
    await expect(proposeFromDocuments([doc(WITH_TABLE)], { callModel: caller, signal: stop.signal })).rejects.toThrow('aborted');
  });
  it('an answer that is nonsense is ignored by the sanitiser: the platform\'s questions stand', async () => {
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: recorder(() => ({ additions: [{ part: 'nope', fields: [{ label: 'x', kind: 'short_text' }] }, 'bad', { part: 'block:1', fields: [{ kind: 'short_text' }, { label: 'y', kind: 'spaceship' }] }] })).caller });
    expect(r.proposal.fields.map((f) => f.label)).not.toContain('x');
    expect(r.proposal.fields.length).toBeGreaterThanOrEqual(3);
  });
});

describe('questions whose kind was a guess', () => {
  const guessed = `1. Perfil\n${Array.from({ length: 10 }, (_, i) => `1.${i + 1} Os senhores concordam com o ponto ${i + 1}?`).join('\n')}\n1.11 Nome`;
  it('go to the AI as a part (the platform\'s reading of them with the text), and what it corrects takes their place', async () => {
    const p = recorder(() => ({ replacements: [{ number: '1.1', fields: [{ label: '1.1 Concorda com o ponto 1?', kind: 'yes_no', required: true }] }] }));
    const r = await proposeFromDocuments([doc(guessed)], { callModel: p.caller });
    expect(p.calls).toHaveLength(1);
    const sent = text(p.calls[0]);
    expect(sent).toContain('the platform read it as');
    expect(sent).not.toContain('1.11 Nome');
    expect(r.meta.aiSections[0]).toMatch(/^questions 1\.1, 1\.2/);
    const one = r.proposal.fields.find((f) => f.number === '1.1' || f.label.startsWith('1.1 Concorda'));
    expect(one).toMatchObject({ kind: 'yes_no', source: 'ai' });
    expect(r.proposal.fields.filter((f) => f.source === 'internal')).toHaveLength(10);        // the other nine and 1.11
  });
});

describe('a text that is no form the platform understands', () => {
  it('goes whole to the AI, as it always did: mode ai, the reasons kept', async () => {
    const p = recorder((req) => (req.tool.name === OVERVIEW_TOOL_NAME ? { general: { name: 'Call X' } } : { form_pages: [{ fields: [{ label: 'Q from the AI', kind: 'short_text' }] }] }));
    const r = await proposeFromDocuments([doc('Dear applicant, please tell us about your company and why you want to apply to this programme. We will read everything.')], { callModel: p.caller });
    expect(r.meta.mode).toBe('ai');
    expect(p.calls.length).toBeGreaterThanOrEqual(2);
    expect(r.meta.why[0]).toContain('below 60%');
    expect(r.proposal.fields.map((f) => f.label)).toContain('Q from the AI');
  });
  it('a PDF with no readable text goes whole, as a PDF', async () => {
    const p = recorder(() => ({ form_pages: [{ fields: [{ label: 'From a scan', kind: 'short_text' }] }] }));
    const r = await proposeFromDocuments([{ kind: 'form', format: 'pdf', text: null, pdfBase64: 'JVBERi0=' }], { callModel: p.caller });
    expect(r.meta).toMatchObject({ mode: 'ai', inputMode: 'pdf', calls: 1 });
  });
});

describe('a regulation and a form together', () => {
  it('the form is read by the platform, the regulation (not a form) is read by the AI for the overview — and nothing else of the form goes', async () => {
    const p = recorder((req) => (req.tool.name === OVERVIEW_TOOL_NAME ? { general: { name: 'INNOV-ID' }, found_for_later: { eligibility_rules: ['Less than 5 years old'] } } : {}));
    const r = await proposeFromDocuments([doc('The call is open to companies. Deadline in March.', 'regulation'), doc(CLEAN)], { callModel: p.caller });
    expect(p.calls.map((c) => c.tool.name)).toEqual([OVERVIEW_TOOL_NAME]);
    expect(text(p.calls[0])).not.toContain('Endereço de e-mail');
    expect(r.meta.mode).toBe('internal+ai');
    expect(r.meta.aiSections.join()).toContain('document');
    expect(r.proposal.general.name).toBe('INNOV-ID');
    expect(r.proposal.foundLater.eligibility).toEqual(['Less than 5 years old']);
    expect(r.proposal.fields).toHaveLength(6);
  });
  it('with no AI, the form still comes out and the regulation is said not to have been read', async () => {
    const caller: ModelCaller = async () => { throw Object.assign(new Error('no key'), { code: 'not_configured' }); };
    const r = await proposeFromDocuments([doc('The call is open to companies.', 'regulation'), doc(CLEAN)], { callModel: caller });
    expect(r.proposal.fields).toHaveLength(6);
    expect(r.meta.mode).toBe('internal');
    expect(r.proposal.attention.some((a) => a.what === 'The regulation')).toBe(true);
  });
});

describe('nothing is said twice', () => {
  it('a question the platform read and the AI made again is kept once, and what was merged is recorded', async () => {
    const p = recorder(() => ({ additions: [{ part: 'block:1', fields: [{ label: '1.2 Morada', kind: 'short_text' }, { label: 'Novo', kind: 'short_text' }] }] }));
    const r = await proposeFromDocuments([doc(WITH_TABLE)], { callModel: p.caller });
    expect(r.proposal.fields.filter((f) => /Morada/.test(f.label))).toHaveLength(1);
    expect(r.meta.deduped.length).toBeGreaterThan(0);
  });
});
