'use client';
// Prompt 301/302 — shared client-side "upload a file, verify it" helper.
// Extracted so Action Plan's "Upload corrected version" (Prompt 302 §3)
// goes through the EXACT SAME Storage-upload + /api/data-room/verify-upload
// gate as the Vault's own new-version flow (documents/page.tsx) — never a
// second, parallel, less-secure upload path.
import { browserClient } from '@/lib/supabase';
import { sanitizeStorageKey } from '@/lib/data-room';

export interface VerifiedUpload { storagePath: string; size: number; malwareScanStatus?: string; provider?: string | null; sha256?: string }

export async function uploadAndVerifyFile(orgId: string, file: File): Promise<VerifiedUpload> {
  const sb = browserClient();
  const path = `${orgId}/${crypto.randomUUID()}-${sanitizeStorageKey(file.name)}`;
  const { error } = await sb.storage.from('data-room').upload(path, file);
  if (error) throw error;

  const res = await fetch('/api/data-room/verify-upload', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storagePath: path, fileName: file.name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.error ?? 'File could not be verified.');
  return { storagePath: path, size: file.size, malwareScanStatus: body.malwareScanStatus, provider: body.provider, sha256: body.sha256 };
}
