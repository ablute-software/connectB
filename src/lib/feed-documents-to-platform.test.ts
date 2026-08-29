import { describe, expect, it, vi } from 'vitest';
import { feedDocumentsToRestOfPlatform } from './feed-documents-to-platform';

describe('feedDocumentsToRestOfPlatform', () => {
  it('calls extractOne once per document, IN SERIES — the second call only starts after the first resolves', async () => {
    const order: string[] = [];
    const extractOne = vi.fn(async (documentId: string) => {
      order.push(`start:${documentId}`);
      await new Promise((r) => setTimeout(r, 0));
      order.push(`end:${documentId}`);
      return { ok: true };
    });
    const failures = await feedDocumentsToRestOfPlatform(
      [{ id: 'doc-1', name: 'First' }, { id: 'doc-2', name: 'Second' }],
      extractOne,
    );
    expect(extractOne).toHaveBeenCalledTimes(2);
    // If this ran in parallel, doc-2 could start before doc-1 ends — the
    // interleaving below is only possible under a strictly serial await.
    expect(order).toEqual(['start:doc-1', 'end:doc-1', 'start:doc-2', 'end:doc-2']);
    expect(failures).toEqual([]);
  });

  it('when the SECOND document fails, the reported failure names the second document, not the first', async () => {
    const extractOne = vi.fn(async (documentId: string) =>
      (documentId === 'doc-2' ? { ok: false, skippedReason: 'too_large' } : { ok: true }));
    const failures = await feedDocumentsToRestOfPlatform(
      [{ id: 'doc-1', name: 'First' }, { id: 'doc-2', name: 'Second' }],
      extractOne,
    );
    expect(failures).toEqual([{ name: 'Second', skippedReason: 'too_large' }]);
  });

  it('when the FIRST document fails and the second succeeds, the failure names the first, not the second', async () => {
    const extractOne = vi.fn(async (documentId: string) =>
      (documentId === 'doc-1' ? { ok: false, skippedReason: 'link_unreadable' } : { ok: true }));
    const failures = await feedDocumentsToRestOfPlatform(
      [{ id: 'doc-1', name: 'First' }, { id: 'doc-2', name: 'Second' }],
      extractOne,
    );
    expect(failures).toEqual([{ name: 'First', skippedReason: 'link_unreadable' }]);
  });

  it('reports onProgress with the document name and its 1-based position before each call', async () => {
    const progress: { name: string; index: number; total: number }[] = [];
    await feedDocumentsToRestOfPlatform(
      [{ id: 'doc-1', name: 'First' }, { id: 'doc-2', name: 'Second' }],
      async () => ({ ok: true }),
      (p) => progress.push(p),
    );
    expect(progress).toEqual([
      { name: 'First', index: 1, total: 2 },
      { name: 'Second', index: 2, total: 2 },
    ]);
  });
});
