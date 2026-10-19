// The applicant's final check (16/10/2026) asks "can this document still be read?" of every document. It is a question about the stored object, not a
// download and not a link: nothing is copied and NO Storage URL is minted to find out (Prompt 750 — a signed URL is a bearer link, and
// scripts/check-no-signed-url-leak.mjs refuses one anywhere under src/lib, which is how the earlier probe turned main red).
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fileReadable, type FileRow } from './store';

const file = (storagePath: string): FileRow => ({
  id: 'f-1', fieldId: 'q-1', source: 'upload', fileName: 'deck.pdf', size: 1234, storagePath, sha256: null, versionId: null, frozenPath: null, revokedAt: null, orgId: 'org-a',
});

type Answer = { data: boolean; error: { message: string } | null };

/** A Storage double whose every other way of touching an object fails the test: it must be answered by the existence check alone. */
function storageDouble(answer: (path: string) => Promise<Answer>) {
  const bucket = {
    exists: vi.fn(answer),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/signed/x?token=1' }, error: null })),
    createSignedUrls: vi.fn(async () => ({ data: [], error: null })),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage.test/public/x' } })),
    download: vi.fn(async () => ({ data: new Blob(['x']), error: null })),
    copy: vi.fn(async () => ({ data: { path: 'x' }, error: null })),
  };
  const from = vi.fn(() => bucket);
  const admin = { storage: { from } } as unknown as SupabaseClient;
  const untouched = () => {
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();           // no link of any kind is minted…
    expect(bucket.createSignedUrls).not.toHaveBeenCalled();
    expect(bucket.getPublicUrl).not.toHaveBeenCalled();
    expect(bucket.download).not.toHaveBeenCalled();                 // …no bytes are read…
    expect(bucket.copy).not.toHaveBeenCalled();                     // …and nothing is copied (that is freezeFile's job, after everything else passes)
  };
  return { admin, bucket, from, untouched };
}

describe('fileReadable', () => {
  it('a document that is still there is readable: ONE existence check on its path in the data room, and nothing minted, read or copied', async () => {
    const s = storageDouble(async () => ({ data: true, error: null }));
    await expect(fileReadable(s.admin, file('org-a/calls/x/deck.pdf'))).resolves.toBe(true);
    expect(s.from).toHaveBeenCalledWith('data-room');
    expect(s.bucket.exists).toHaveBeenCalledTimes(1);
    expect(s.bucket.exists).toHaveBeenCalledWith('org-a/calls/x/deck.pdf');
    s.untouched();
  });

  it('a document that is gone is not readable (the check answers "not found"), and still nothing is minted', async () => {
    const s = storageDouble(async () => ({ data: false, error: { message: 'Object not found' } }));
    await expect(fileReadable(s.admin, file('org-a/calls/x/gone.pdf'))).resolves.toBe(false);
    expect(s.bucket.exists).toHaveBeenCalledWith('org-a/calls/x/gone.pdf');
    s.untouched();
  });

  it('only a clear yes counts: an answer that is not true, or that carries an error, is a no', async () => {
    expect(await fileReadable(storageDouble(async () => ({ data: false, error: null })).admin, file('p'))).toBe(false);
    expect(await fileReadable(storageDouble(async () => ({ data: true, error: { message: 'half an answer' } })).admin, file('p'))).toBe(false);
  });

  it('a Storage that fails (the check throws for anything but "not found") is a no, not a crash — the final check lists the document instead of answering 500', async () => {
    const s = storageDouble(async () => { throw new Error('fetch failed'); });
    await expect(fileReadable(s.admin, file('org-a/calls/x/deck.pdf'))).resolves.toBe(false);
    s.untouched();
  });
});
