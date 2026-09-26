import { describe, expect, it } from 'vitest';
import { googlePreviewUrl, resolveViewerKind } from './document-viewer';

describe('resolveViewerKind', () => {
  it('a PDF in storage is pdf', () => {
    expect(resolveViewerKind({ storage_path: 'org/deck.pdf' })).toBe('pdf');
    expect(resolveViewerKind({ storage_path: 'org/Deck.PDF' })).toBe('pdf');
  });

  it('an image in storage is image', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      expect(resolveViewerKind({ storage_path: `org/photo.${ext}` })).toBe('image');
    }
  });

  it('a docx/xlsx/pptx in storage is external — no conversion attempted', () => {
    expect(resolveViewerKind({ storage_path: 'org/cap-table.xlsx' })).toBe('external');
    expect(resolveViewerKind({ storage_path: 'org/deck.pptx' })).toBe('external');
    expect(resolveViewerKind({ storage_path: 'org/memo.docx' })).toBe('external');
  });

  it('a Google Docs/Slides/Sheets link is embed', () => {
    expect(resolveViewerKind({ external_url: 'https://docs.google.com/document/d/1AbC/edit' })).toBe('embed');
    expect(resolveViewerKind({ external_url: 'https://docs.google.com/presentation/d/1AbC/view' })).toBe('embed');
  });

  it('a Google Drive file link is embed', () => {
    expect(resolveViewerKind({ external_url: 'https://drive.google.com/file/d/1AbC/view' })).toBe('embed');
  });

  it('a Notion or other external link is external', () => {
    expect(resolveViewerKind({ external_url: 'https://www.notion.so/workspace/Some-Page-abc123' })).toBe('external');
  });

  it('storage_path wins over external_url when somehow both are set', () => {
    expect(resolveViewerKind({ storage_path: 'org/deck.pdf', external_url: 'https://www.notion.so/x' })).toBe('pdf');
  });

  it('neither field set is external', () => {
    expect(resolveViewerKind({})).toBe('external');
  });
});

describe('googlePreviewUrl', () => {
  it('strips /edit and appends /preview for a Docs link', () => {
    expect(googlePreviewUrl('https://docs.google.com/document/d/1AbC23/edit?usp=sharing'))
      .toBe('https://docs.google.com/document/d/1AbC23/preview');
  });

  it('strips /view and appends /preview for a Drive file link', () => {
    expect(googlePreviewUrl('https://drive.google.com/file/d/1AbC23/view'))
      .toBe('https://drive.google.com/file/d/1AbC23/preview');
  });

  it('works for Sheets and Slides too', () => {
    expect(googlePreviewUrl('https://docs.google.com/spreadsheets/d/1AbC23/edit#gid=0'))
      .toBe('https://docs.google.com/spreadsheets/d/1AbC23/preview');
    expect(googlePreviewUrl('https://docs.google.com/presentation/d/1AbC23/edit'))
      .toBe('https://docs.google.com/presentation/d/1AbC23/preview');
  });

  it('a bare link with no suffix at all still gets /preview appended', () => {
    expect(googlePreviewUrl('https://docs.google.com/document/d/1AbC23'))
      .toBe('https://docs.google.com/document/d/1AbC23/preview');
  });

  it('returns null for a non-Google link', () => {
    expect(googlePreviewUrl('https://www.notion.so/workspace/Some-Page-abc123')).toBeNull();
  });
});
