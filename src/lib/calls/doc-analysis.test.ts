// Prompt 918 (I3) — what the internal engine reads from a document: dates, tax IDs, names, and the verdicts "right document", "valid document" and "authentic document". Every doubt is a person's job
// (To validate); a failure is only a clear one. A scanned PDF is never read.
import { describe, expect, it } from 'vitest';
import { analyzeAuthentic, analyzeRight, analyzeValid, datesIn, issueDate, monthsBetween, normalizeName, SCANNED_REASON, taxIdsIn, unreadableResult, validUntil, type DocText } from './doc-analysis';
import { docTypeByKey, prepareRecipe } from './doc-recipe';
import type { EligibilityRule } from './eligibility';

const CERT_TEXT = `CERTIDÃO PERMANENTE
Conservatória do Registo Comercial de Lisboa
Código de acesso: 1234-5678-9012
Matrícula e NIPC: 513 456 789
Firma: Acme Robotics, Lda.
Sede: Rua das Flores 1, Lisboa
Certidão emitida em 12/09/2026. Válida até 12/03/2027.`;
const doc = (text: string, extra: Partial<DocText> = {}): DocText => ({ fileName: 'certidao.pdf', pages: [text], ...extra });
const recipeFor = (kind: EligibilityRule['kind'], params: Record<string, unknown>, label = 'Permanent Certificate', instruction: string | null = null) =>
  prepareRecipe({ kind, params: params as never, note: null }, { label, instruction, expectedType: null, maxAgeMonths: null }, [{ id: 'name-q', label: 'Company name' }, { id: 'tax-q', label: 'Tax ID' }]).recipe;

describe('reading values out of the text', () => {
  it('dates in every common way, in order', () => {
    expect(datesIn('Emitida em 12/09/2026, válida até 12-03-2027, registada a 2020-01-31, em 5 de outubro de 2025 e a 3 March 2024').map((d) => d.day))
      .toEqual(['2026-09-12', '2027-03-12', '2020-01-31', '2025-10-05', '2024-03-03']);
    expect(datesIn('31/02/2026')).toEqual([]);
  });
  it('the issue date and the validity limit come from their labels, not from any date', () => {
    expect(issueDate(CERT_TEXT)).toBe('2026-09-12');
    expect(validUntil(CERT_TEXT)).toBe('2027-03-12');
    expect(issueDate('Constituída em 01/01/2020')).toBeNull();
  });
  it('tax IDs: labelled ones and every nine-digit number', () => {
    const ids = taxIdsIn(CERT_TEXT);
    expect(ids.labelled).toEqual(['513456789']);
    expect(taxIdsIn('NIF 123 456 789 e o telefone 912345678').any).toEqual(['912345678']);
  });
  it('company names compare without punctuation, accents or the legal suffix', () => {
    expect(normalizeName('Acme Robotics, Lda.')).toBe('acme robotics');
    expect(normalizeName('ÁCME ROBOTICS Unipessoal Lda')).toBe('acme robotics');
  });
  it('months between two days count a month once its day is reached', () => {
    expect([monthsBetween('2026-09-12', '2026-12-11'), monthsBetween('2026-09-12', '2026-12-12'), monthsBetween('2026-09-12', '2026-09-12')]).toEqual([2, 3, 0]);
  });
});

describe('a file that cannot be read goes to a person, never fails', () => {
  it('a scanned PDF (image only) says so; a damaged one says so; a file with no text too', () => {
    expect(unreadableResult('r', { fileName: 'a.pdf', pages: null, scanned: true })).toMatchObject({ outcome: 'validate', reason: SCANNED_REASON });
    expect(unreadableResult('r', { fileName: 'a.pdf', pages: null, unreadable: 'encrypted' })?.reason).toContain('encrypted');
    expect(unreadableResult('r', { fileName: 'a.pdf', pages: ['  '] })?.outcome).toBe('validate');
    expect(unreadableResult('r', doc(CERT_TEXT))).toBeNull();
  });
  it('every document rule passes the same way: nothing is judged on an unreadable file', () => {
    const scanned: DocText = { fileName: 'scan.pdf', pages: null, scanned: true };
    const r = recipeFor('doc_valid', { maxAgeMonths: 3 });
    expect(analyzeRight('r', r, scanned).outcome).toBe('validate');
    expect(analyzeValid('r', r, scanned, {}, '2026-10-01').outcome).toBe('validate');
    expect(analyzeAuthentic('r', r, scanned).reason).toContain(SCANNED_REASON);
  });
});

describe('"right document"', () => {
  const right = recipeFor('doc_right', { docType: null });
  it('a permanent certificate is recognised, with the page and the quote', () => {
    const r = analyzeRight('r', right, doc(CERT_TEXT));
    expect(r.outcome).toBe('pass');
    expect(r.evidence).toMatchObject({ page: 1, fileName: 'certidao.pdf' });
    expect(r.evidence?.quote).toBeTruthy();
  });
  it('an invoice is not a permanent certificate — and a document that looks like ANOTHER known kind is a clear failure', () => {
    const social = 'Instituto da Segurança Social, I.P.\nDeclaração de situação contributiva regularizada. A entidade não é devedora. Segurança Social Direta.';
    const r = analyzeRight('r', right, doc(social));
    expect(r.outcome).toBe('fail');
    expect(r.reason).toContain('Social security clearance');
  });
  it('a document that matches nothing the platform knows is a doubt, not a failure', () => {
    expect(analyzeRight('r', right, doc('Fatura n.º 2026/12. Total a pagar: 120,00 EUR. Obrigado pela preferência. '.repeat(3))).outcome).toBe('validate');
  });
  it('a kind it does not know has no automatic check — a person validates every one', () => {
    const odd = recipeFor('doc_right', { docType: null }, 'Letter of intent');
    expect(analyzeRight('r', odd, doc('Dear sirs, we intend to... '.repeat(5))).outcome).toBe('validate');
  });
  it('a kind with no fixed wording passes once a readable file is attached', () => {
    const deck = recipeFor('doc_right', { docType: 'pitch_deck' }, 'Deck');
    expect(analyzeRight('r', deck, doc('Slide 1. Problem. Slide 2. Solution. '.repeat(3))).outcome).toBe('pass');
  });
});

describe('"valid document"', () => {
  const valid = (maxAge: number | null, matchName = true, matchTax = true) => recipeFor('doc_valid', { maxAgeMonths: maxAge, matchName: matchName ? 'name-q' : null, matchTaxId: matchTax ? 'tax-q' : null });
  const declared = { legalName: 'Acme Robotics, Lda', taxId: '513456789' };
  it('passes when it is recent enough and the name and the tax ID are the declared ones', () => {
    const r = analyzeValid('r', valid(3), doc(CERT_TEXT), declared, '2026-10-01');
    expect(r.outcome).toBe('pass');
    expect(r.reason).toContain('Issued on 2026-09-12');
  });
  it('fails clearly when it is older than the limit — and the day of the limit still passes', () => {
    expect(analyzeValid('r', valid(3), doc(CERT_TEXT), declared, '2026-12-12').outcome).toBe('pass');          // exactly 3 months
    const old = analyzeValid('r', valid(3), doc(CERT_TEXT), declared, '2026-12-13');
    expect(old.outcome).toBe('pass');                                                                         // 3 months and a day: months counted whole
    expect(analyzeValid('r', valid(2), doc(CERT_TEXT), declared, '2026-12-13').outcome).toBe('fail');
  });
  it('fails when the validity date has passed', () => {
    const r = analyzeValid('r', valid(null), doc(CERT_TEXT), declared, '2027-04-01');
    expect(r.outcome).toBe('fail');
    expect(r.reason).toContain('valid until 2027-03-12');
  });
  it('a different tax ID PRINTED on the document is a clear failure; none found is a doubt; the declared one found passes', () => {
    expect(analyzeValid('r', valid(null, false), doc(CERT_TEXT), { taxId: '999999999' }, '2026-10-01').outcome).toBe('fail');
    expect(analyzeValid('r', valid(null, false), doc('CERTIDÃO PERMANENTE sem número fiscal impresso '.repeat(3)), { taxId: '513456789' }, '2026-10-01').outcome).toBe('validate');
    expect(analyzeValid('r', valid(null, false), doc(CERT_TEXT), { taxId: '513 456 789' }, '2026-10-01').outcome).toBe('pass');
  });
  it('a different company name is NEVER a failure on its own (it may be the trade name): a person checks', () => {
    const r = analyzeValid('r', valid(null, true, false), doc(CERT_TEXT), { legalName: 'Totally Different Brand' }, '2026-10-01');
    expect(r.outcome).toBe('validate');
    expect(r.reason).toContain('trade name');
  });
  it('an age limit with no issue date in the document is a doubt', () => {
    expect(analyzeValid('r', valid(3, false, false), doc('CERTIDÃO PERMANENTE registo comercial matrícula '.repeat(3)), declared, '2026-10-01').outcome).toBe('validate');
  });
  it('nothing to compare and no limit: a readable document passes', () => {
    expect(analyzeValid('r', valid(null, false, false), doc(CERT_TEXT), declared, '2026-10-01').outcome).toBe('pass');
  });
  it('nothing declared to compare with is a doubt, never a failure', () => {
    expect(analyzeValid('r', valid(null), doc(CERT_TEXT), {}, '2026-10-01').outcome).toBe('validate');
  });
});

describe('"authentic document" is always a person', () => {
  it('shows the access code and the official portal; notes a digital signature without trusting it', () => {
    const r = analyzeAuthentic('r', recipeFor('doc_authentic', {}), doc(CERT_TEXT, { hasSignature: true }));
    expect(r.outcome).toBe('validate');
    expect(r.reason).toContain('Access code on the document: 1234-5678-9012');
    expect(r.reason).toContain('Portal da Empresa');
    expect(r.reason).toContain('not verified automatically');
    expect(r.evidence?.quote).toBe('1234-5678-9012');
  });
  it('a document with no code still goes to a person', () => {
    expect(analyzeAuthentic('r', recipeFor('doc_authentic', {}, 'Cap table'), doc('Cap table. '.repeat(10))).outcome).toBe('validate');
  });
  it('the dictionary has the certificate with an access-code pattern', () => {
    expect(docTypeByKey('permanent_certificate')?.accessCode).toBeTruthy();
  });
});
