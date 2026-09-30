import { describe, expect, it } from 'vitest';
import { shouldLogOpen, resolveContentType, contentDispositionValue } from './document-proxy';

function reqWithRange(range: string | null): Request {
  return new Request('https://example.com/x', range ? { headers: { Range: range } } : undefined);
}

describe('shouldLogOpen (Prompt 750 §2 — one open per real open, not per byte-range chunk)', () => {
  it('logs when there is no Range header at all', () => {
    expect(shouldLogOpen(reqWithRange(null))).toBe(true);
  });
  it('logs a Range starting at byte 0', () => {
    expect(shouldLogOpen(reqWithRange('bytes=0-1023'))).toBe(true);
    expect(shouldLogOpen(reqWithRange('bytes=0-'))).toBe(true);
  });
  it('does NOT log a Range starting partway through (the 2nd..Nth chunk of a scrub/scroll)', () => {
    expect(shouldLogOpen(reqWithRange('bytes=1024-2047'))).toBe(false);
    expect(shouldLogOpen(reqWithRange('bytes=500000-'))).toBe(false);
  });
});

describe('resolveContentType (Prompt 750 §5 — inline allowlist)', () => {
  it('renders the exact allowlisted kinds inline', () => {
    expect(resolveContentType('deck.pdf')).toEqual({ contentType: 'application/pdf', inline: true });
    expect(resolveContentType('logo.png')).toEqual({ contentType: 'image/png', inline: true });
    expect(resolveContentType('photo.jpg')).toEqual({ contentType: 'image/jpeg', inline: true });
    expect(resolveContentType('photo.jpeg')).toEqual({ contentType: 'image/jpeg', inline: true });
    expect(resolveContentType('banner.webp')).toEqual({ contentType: 'image/webp', inline: true });
    expect(resolveContentType('meme.gif')).toEqual({ contentType: 'image/gif', inline: true });
    expect(resolveContentType('demo.mp4')).toEqual({ contentType: 'video/mp4', inline: true });
    expect(resolveContentType('demo.webm')).toEqual({ contentType: 'video/webm', inline: true });
    expect(resolveContentType('notes.txt')).toEqual({ contentType: 'text/plain; charset=utf-8', inline: true });
  });

  it('forces a download for every Office/csv/md format, even though those are legitimate Vault uploads', () => {
    for (const name of ['contract.docx', 'model.xlsx', 'deck.pptx', 'old.doc', 'old.xls', 'old.ppt', 'data.csv', 'readme.md']) {
      expect(resolveContentType(name)).toEqual({ contentType: 'application/octet-stream', inline: false });
    }
  });

  it('never renders svg/html/xml/js inline — not in the allowlist under any name', () => {
    for (const name of ['image.svg', 'page.html', 'data.xml', 'script.js', 'x.htm']) {
      const { inline } = resolveContentType(name);
      expect(inline).toBe(false);
    }
  });

  it('forces a download for an unrecognised or missing extension', () => {
    expect(resolveContentType('mystery.bin')).toEqual({ contentType: 'application/octet-stream', inline: false });
    expect(resolveContentType('no-extension')).toEqual({ contentType: 'application/octet-stream', inline: false });
  });

  it('is case-insensitive on the extension', () => {
    expect(resolveContentType('DECK.PDF')).toEqual({ contentType: 'application/pdf', inline: true });
  });
});

describe('contentDispositionValue', () => {
  it('says inline or attachment and carries both a plain and a UTF-8 filename', () => {
    const inline = contentDispositionValue('deck.pdf', true);
    expect(inline).toContain('inline;');
    expect(inline).toContain('filename="deck.pdf"');
    expect(inline).toContain("filename*=UTF-8''deck.pdf");

    const attachment = contentDispositionValue('model.xlsx', false);
    expect(attachment).toContain('attachment;');
  });

  it('never lets the filename break out of the header value', () => {
    const value = contentDispositionValue('evil".pdf', true);
    // The ASCII fallback field must not contain an unescaped quote that
    // would terminate the filename="..." token early.
    const asciiField = /filename="([^]*?)"/.exec(value)?.[1] ?? '';
    expect(asciiField).not.toContain('"');
  });

  it('percent-encodes a non-ASCII filename for the UTF-8 field, and substitutes ASCII for the plain one', () => {
    const value = contentDispositionValue('contrato_ção.pdf', true);
    expect(value).toContain("filename*=UTF-8''contrato_%C3%A7%C3%A3o.pdf");
    expect(value).toContain('filename="contrato___o.pdf"');
  });
});
