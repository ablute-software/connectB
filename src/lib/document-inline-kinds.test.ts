import { describe, expect, it } from 'vitest';
import { inlineKindFor, extOf } from './document-inline-kinds';

describe('extOf', () => {
  it('lowercases and strips the leading dot', () => {
    expect(extOf('Deck.PDF')).toBe('pdf');
    expect(extOf('a.b.docx')).toBe('docx');
  });
  it('is empty for a file with no extension', () => {
    expect(extOf('README')).toBe('');
  });
});

describe('inlineKindFor (Prompt 750, review fix — the viewer\'s own "can I preview this" decision)', () => {
  it('video for mp4/webm', () => {
    expect(inlineKindFor('demo.mp4')).toBe('video');
    expect(inlineKindFor('demo.webm')).toBe('video');
  });
  it('iframe for everything else in the inline allowlist', () => {
    for (const name of ['deck.pdf', 'logo.png', 'photo.jpg', 'photo.jpeg', 'banner.webp', 'meme.gif', 'notes.txt']) {
      expect(inlineKindFor(name)).toBe('iframe');
    }
  });
  it('none for every Office format — the modal must show a download state, not a blank frame', () => {
    for (const name of ['contract.docx', 'model.xlsx', 'deck.pptx', 'old.doc', 'old.xls', 'old.ppt', 'data.csv', 'readme.md']) {
      expect(inlineKindFor(name)).toBe('none');
    }
  });
  it('none for svg/html/xml/js and anything unrecognised', () => {
    for (const name of ['image.svg', 'page.html', 'data.xml', 'script.js', 'mystery.bin', 'no-extension']) {
      expect(inlineKindFor(name)).toBe('none');
    }
  });
});
