// Prompt 922 (I3) — blind evaluation, pure: the startup's name, the people and their emails are blanked in the answers and in the names of the files — whatever the case, the accents, the separators a file name
// uses and the legal suffix — while ordinary words stay, the shape of the answers is untouched and the files keep a useful name.
import { describe, expect, it } from 'vitest';
import { HIDDEN, buildRedactor, identifierForms, identifiersOf, maskAnswers, maskFileName } from './eval-mask';
import { GENERIC_EMAIL_DOMAINS } from './duplicates';

const redact = buildRedactor(identifiersOf({
  startupName: 'Acme Robotics, Lda.', genericDomains: GENERIC_EMAIL_DOMAINS,
  people: [{ name: 'João Ferreira', email: 'joao@acme.pt' }, { name: 'Maria Santos', email: 'maria.santos@gmail.com' }],
}));

describe('the forms an identifier can take', () => {
  it('as written, without the legal suffix, and joined the way a file name joins words — never a short form', () => {
    expect(identifierForms('Acme Robotics, Lda.')).toEqual(expect.arrayContaining(['acme robotics, lda.'.replace(',', '').replace('  ', ' '), 'acme robotics', 'acme-robotics', 'acme_robotics', 'acme.robotics', 'acmerobotics', 'acme-robotics-lda']));
    expect(identifierForms('Co')).toEqual([]);
    expect(identifierForms('SA')).toEqual([]);
    expect(identifierForms('Ana')).toEqual([]);                                                  // too short to be safe: it would blank ordinary words
  });
});

describe('redacting a text', () => {
  it('blanks the startup (any case, with or without the suffix, accents folded), the people and every email address', () => {
    expect(redact.text('We are ACME Robotics and João Ferreira leads it.')).toBe(`We are ${HIDDEN} and ${HIDDEN} leads it.`);
    expect(redact.text('Acme Robotics, Lda. was founded in 2021')).toBe(`${HIDDEN}, Lda. was founded in 2021`);   // the legal suffix alone identifies nobody and stays
    expect(redact.text('Write to joao@acme.pt or anyone@other.com')).toBe(`Write to ${HIDDEN} or ${HIDDEN}`);
    expect(redact.text('joao ferreira / JOAO FERREIRA')).toBe(`${HIDDEN} / ${HIDDEN}`);
  });
  it('keeps what is not an identifier', () => {
    expect(redact.text('We build robots for health care; 4 patents; revenue 120 000 €.')).toBe('We build robots for health care; 4 patents; revenue 120 000 €.');
    expect(redact.changed('A plain sentence.')).toBe(false);
    expect(redact.changed('Acme Robotics')).toBe(true);
  });
  it('the company name inside a domain (acme.pt) is an identifier; a generic mailbox domain (gmail) is not', () => {
    expect(redact.text('Founded as acme before it grew')).toBe(`Founded as ${HIDDEN} before it grew`);
    expect(redact.text('We use gmail every day')).toBe('We use gmail every day');
  });
  it('nothing to hide: the text is untouched (no regular expression built from nothing)', () => {
    const none = buildRedactor([null, undefined, '', 'ab']);
    expect(none.text('anything at all')).toBe('anything at all');
  });
  it('characters that mean something in a regular expression in a name are taken literally', () => {
    const r = buildRedactor(['C++ Labs [Beta] Lda']);
    expect(r.text('We love C++ Labs [Beta] a lot')).toBe(`We love ${HIDDEN} a lot`);
  });
});

describe('answers and file names', () => {
  const fields = [{ id: 'q-name', kind: 'short_text' as const }, { id: 'q-mail', kind: 'email' as const }, { id: 'q-web', kind: 'url' as const }, { id: 'q-pitch', kind: 'long_text' as const }, { id: 'q-n', kind: 'number' as const }, { id: 'q-g', kind: 'group' as const }];
  it('hides an email or a web address whole, blanks the rest inside text, groups and tables, and leaves numbers, booleans, empties and the shape alone', () => {
    const answers = {
      'q-name': 'Acme Robotics', 'q-mail': 'joao@acme.pt', 'q-web': 'https://acme.pt', 'q-pitch': 'João Ferreira built it. We cure things.', 'q-n': 500000,
      'q-g': [{ 'q-name': 'Maria Santos', 'q-n': 3 }], 'q-empty': '', 'q-null': null,
    } as never;
    const out = maskAnswers([...fields, { id: 'q-empty', kind: 'email' }, { id: 'q-null', kind: 'url' }], answers, redact);
    expect(out).toEqual({ 'q-name': HIDDEN, 'q-mail': HIDDEN, 'q-web': HIDDEN, 'q-pitch': `${HIDDEN} built it. We cure things.`, 'q-n': 500000, 'q-g': [{ 'q-name': HIDDEN, 'q-n': 3 }], 'q-empty': '', 'q-null': null });
  });
  it('a file whose name holds an identifier is shown under its question\'s name; a neutral name is kept; the extension stays', () => {
    expect(maskFileName('certidao-acme-robotics-lda.pdf', redact, 'Permanent Certificate', 0)).toBe('Permanent Certificate — document 1.pdf');
    expect(maskFileName('Joao_Ferreira_CC.PDF', redact, 'ID', 1)).toBe('ID — document 2.PDF');
    expect(maskFileName('financials-2025.xlsx', redact, 'Financials', 0)).toBe('financials-2025.xlsx');
    expect(maskFileName('acmerobotics', redact, '', 3)).toBe('Document — document 4');
  });
});
