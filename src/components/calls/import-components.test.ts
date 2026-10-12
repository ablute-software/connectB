// Prompt 909 (I2, I4) — what the two import dialogs say BEFORE the person does anything: the formats and limits of the
// import from documents written out, the privacy notice shown before anything is sent (nothing is sent by rendering),
// and the button that cannot be pressed with no file. The portal is replaced by its children so the dialog can be
// rendered to static markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (children: unknown) => children }));

import { ImportFromDocuments } from './ImportFromDocuments';
import { ImportFormDialog } from './ImportFormDialog';
import { CallDangerZone } from './CallDangerZone';
import { SourceDocumentsPanel } from './SourceDocumentsPanel';

beforeAll(() => { vi.stubGlobal('document', { body: {} }); });

/** The opening tag that carries a data-testid, and whether THAT element is disabled (not a Tailwind "disabled:" class). */
const tagOf = (html: string, testid: string): string => {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) throw new Error(`no element with data-testid="${testid}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};
const isDisabled = (html: string, testid: string) => /\sdisabled(=|\s|>)/.test(tagOf(html, testid));

describe('Import from documents, before anything is sent', () => {
  const html = () => renderToStaticMarkup(createElement(ImportFromDocuments, { callId: 'c1', timezone: 'Europe/Lisbon', currentFieldCount: 0, onClose: () => {}, onApply: async () => ({ ok: true }) }));

  it('says, before the upload, that the document is read by the AI provider and not to upload applicants\' documents', () => {
    const out = html();
    expect(out).toContain('The document is read by our AI provider to propose a configuration. Do not upload applicants’ documents.');
    expect(out.indexOf('Do not upload applicants')).toBeLessThan(out.indexOf('type="file"'));
  });
  it('writes the formats and the limits', () => {
    const out = html();
    expect(out).toContain('PDF with readable text');
    expect(out).toContain('Word (.docx)');
    expect(out).toContain('Excel (.xlsx)');
    expect(out).toContain('Up to 3 files, 4 MB in total');
    expect(out).toContain('PDFs up to 40 pages');
    expect(out).toContain('scanned PDF');
    expect(out).toContain('accept=".pdf,.docx,.xlsx"');
  });
  it('offers nothing to press until a document is chosen', () => {
    expect(isDisabled(html(), 'import-docs-send')).toBe(true);
  });
});

describe('Import form from another call', () => {
  it('starts with the choice and no import possible until a call is picked; says what Replace and Add do', () => {
    const out = renderToStaticMarkup(createElement(ImportFormDialog, { callId: 'c1', currentFieldCount: 3, onClose: () => {}, onImport: async () => ({ ok: true }) }));
    expect(out).toContain('Import form from another call');
    expect(out).toContain('Replace current form');
    expect(out).toContain('Add after current form');
    expect(out).toContain('The imported pages come after the existing ones.');   // Add is the default over a form that has fields
    expect(isDisabled(out, 'import-confirm')).toBe(true);
  });
  it('over an empty form it says so instead of warning about a replacement', () => {
    const out = renderToStaticMarkup(createElement(ImportFormDialog, { callId: 'c1', currentFieldCount: 0, onClose: () => {}, onImport: async () => ({ ok: true }) }));
    expect(out).toContain('The current form is empty.');
  });
});

describe('Delete and archive, at the bottom of General', () => {
  const zone = (over: Partial<Parameters<typeof CallDangerZone>[0]> = {}) => renderToStaticMarkup(createElement(CallDangerZone, {
    actions: { canDelete: true, canArchive: true }, status: 'draft', applicationsTotal: 0, canManage: true, busy: false, onDelete: () => {}, onArchive: () => {}, ...over,
  }));
  it('both offered on a draft nobody applied to', () => {
    const out = zone();
    expect(out).toContain('Delete call'); expect(out).toContain('Archive call');
    expect(isDisabled(out, 'delete-call')).toBe(false);
    expect(isDisabled(out, 'archive-call')).toBe(false);
  });
  it('with applications: delete is disabled and says to archive instead', () => {
    const out = zone({ actions: { canDelete: false, canArchive: true }, status: 'closed', applicationsTotal: 4 });
    expect(isDisabled(out, 'delete-call')).toBe(true);
    expect(isDisabled(out, 'archive-call')).toBe(false);
    expect(out).toContain('has applications, so it cannot be deleted. Archive it instead.');
  });
  it('an open call must be closed before it is archived', () => {
    const out = zone({ actions: { canDelete: false, canArchive: false }, status: 'open' });
    expect(isDisabled(out, 'archive-call')).toBe(true);
    expect(isDisabled(out, 'delete-call')).toBe(true);
    expect(out).toContain('Close the call before archiving it.');
  });
  it('nothing for a person who cannot configure the call; a note for an archived one', () => {
    expect(zone({ canManage: false })).toBe('');
    expect(zone({ status: 'archived' })).toContain('This call is archived.');
  });
});

describe('Source documents', () => {
  it('renders nothing until it has loaded (no flash of an empty box)', () => {
    expect(renderToStaticMarkup(createElement(SourceDocumentsPanel, { callId: 'c1', canConfigure: true, locked: false, reloadKey: 0, onImport: () => {} }))).toBe('');
  });
});
