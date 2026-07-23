import { describe, expect, it } from 'vitest';
import { isEditableLink, normalizeDocumentUrl, sanitizeStorageKey } from './data-room';

describe('sanitizeStorageKey', () => {
  it('folds diacritics, replaces spaces/parentheses, and keeps the extension', () => {
    expect(sanitizeStorageKey('Consulta de Certidão Permanente 07-2026 (1).pdf'))
      .toBe('Consulta-de-Certidao-Permanente-07-2026-1.pdf');
  });

  it('leaves an already-safe filename untouched', () => {
    expect(sanitizeStorageKey('deck-v3.pdf')).toBe('deck-v3.pdf');
  });

  it('handles a file with no extension', () => {
    expect(sanitizeStorageKey('README')).toBe('README');
  });

  it('never produces an empty base name', () => {
    expect(sanitizeStorageKey('日本語.pdf')).toBe('file.pdf');
  });

  it('strips illegal characters from the extension too', () => {
    expect(sanitizeStorageKey('weird.p?d#f')).toBe('weird.pdf');
  });
});

describe('normalizeDocumentUrl', () => {
  it('normalizes a Google Docs edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/document/d/1AbC23/edit?usp=sharing'))
      .toBe('https://docs.google.com/document/d/1AbC23/preview');
  });

  it('normalizes a Google Sheets edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/spreadsheets/d/1AbC23/edit#gid=0'))
      .toBe('https://docs.google.com/spreadsheets/d/1AbC23/preview');
  });

  it('normalizes a Google Slides edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/presentation/d/1AbC23/edit'))
      .toBe('https://docs.google.com/presentation/d/1AbC23/preview');
  });

  it('normalizes a Google Drive file edit link to /view', () => {
    expect(normalizeDocumentUrl('https://drive.google.com/file/d/1AbC23/edit?usp=sharing'))
      .toBe('https://drive.google.com/file/d/1AbC23/view');
  });

  it('leaves a non-Google /edit link untouched', () => {
    const url = 'https://www.notion.so/workspace/Some-Page-abc123/edit';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });

  it('leaves an already view-only Google link untouched', () => {
    const url = 'https://docs.google.com/document/d/1AbC23/preview';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });
});

describe('isEditableLink', () => {
  it('accepts a Google Docs edit link once normalized', () => {
    expect(isEditableLink('https://docs.google.com/document/d/1AbC23/edit?usp=sharing')).toBe(false);
  });

  it('still rejects a literal non-Google /edit link', () => {
    expect(isEditableLink('https://www.notion.so/workspace/Some-Page-abc123/edit')).toBe(true);
  });

  it('accepts an ordinary view-only link', () => {
    expect(isEditableLink('https://example.com/deck.pdf')).toBe(false);
  });
});
