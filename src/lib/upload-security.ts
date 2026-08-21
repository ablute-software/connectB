// Prompt 301 §3 — Vault upload security. Confirmed by grep before writing
// this: nothing anywhere in src/ validated file type or content before now
// (sanitizeStorageKey in data-room.ts only makes the STORAGE PATH safe —
// path traversal — never touches the bytes themselves), and upload went
// straight from the browser to Supabase Storage with no server in between.
//
// Two independent checks, both server-side, both real:
//   1. detectAllowedKind — an ALLOWLIST of what the Vault actually expects
//      (PDF, Office docs, images, CSV/plain text — never executables or
//      scripts), validated by the file's REAL content (magic bytes), not
//      the trivially-spoofable filename extension. For ZIP-based Office
//      formats (docx/xlsx/pptx), BOTH the magic bytes AND the extension
//      must agree — magic bytes alone can't distinguish a legitimate .docx
//      from a bare .zip renamed to .docx, so a plain .zip is never allowed
//      through even though its signature matches.
//   2. scanWithVirusTotal — malware scanning via VirusTotal's public API,
//      called server-side, never trusted to the client. Honest about its
//      real coverage: a file VT has seen before gets an instant verdict; a
//      genuinely new file is submitted for analysis but NOT waited for
//      synchronously (VT scans can take minutes; a serverless function on
//      Vercel's Hobby plan cannot block that long) — it comes back
//      'pending' and the daily automations cron re-checks it later. This
//      is a real, documented limitation, not silently pretended away: a
//      brand-new malicious file could theoretically be granted to an
//      investor before VT's async scan resolves. What bounds that window
//      in practice is that granting access is always a SEPARATE, deliberate
//      founder action after upload, never automatic.
import 'server-only';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AllowedFileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls' | 'ppt' | 'jpg' | 'png' | 'csv' | 'txt';

const EXT_KIND: Record<string, AllowedFileKind> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'doc', xls: 'xls', ppt: 'ppt',
  jpg: 'jpg', jpeg: 'jpg', png: 'png', csv: 'csv', txt: 'txt',
};

function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

function bytesStartWith(bytes: Buffer, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

// Coarse binary-content sniff for CSV/TXT, which have no magic bytes of
// their own: a real text file shouldn't contain NUL bytes in its first
// chunk. Grosseiro de propósito — false negatives (rejecting an unusual but
// legitimate text file) are far cheaper here than false positives.
function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  for (const b of sample) if (b === 0) return false;
  return true;
}

export function detectAllowedKind(bytes: Buffer, filename: string): AllowedFileKind | null {
  const ext = extOf(filename);
  const expectedKind = EXT_KIND[ext];
  if (!expectedKind) return null; // extension not even in the allowlist — reject before touching bytes

  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46])) return expectedKind === 'pdf' ? 'pdf' : null; // %PDF
  if (bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    // ZIP-based — only Office formats are allowed through, never a bare .zip.
    return (expectedKind === 'docx' || expectedKind === 'xlsx' || expectedKind === 'pptx') ? expectedKind : null;
  }
  if (bytesStartWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return (expectedKind === 'doc' || expectedKind === 'xls' || expectedKind === 'ppt') ? expectedKind : null;
  }
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return expectedKind === 'jpg' ? 'jpg' : null;
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return expectedKind === 'png' ? 'png' : null;
  if ((expectedKind === 'csv' || expectedKind === 'txt') && looksLikeText(bytes)) return expectedKind;
  return null;
}

export type ScanVerdict = { status: 'clean' | 'flagged' | 'pending'; provider: string | null; detail: string };

const VT_BASE = 'https://www.virustotal.com/api/v3';

export async function scanWithVirusTotal(bytes: Buffer, filename: string): Promise<ScanVerdict> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) {
    return { status: 'pending', provider: null, detail: 'VIRUSTOTAL_API_KEY not configured — magic-byte check only, no malware scan performed.' };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  try {
    const lookup = await fetch(`${VT_BASE}/files/${sha256}`, { headers: { 'x-apikey': apiKey } });
    if (lookup.ok) {
      const body = await lookup.json();
      const stats = body?.data?.attributes?.last_analysis_stats as { malicious?: number; suspicious?: number } | undefined;
      if ((stats?.malicious ?? 0) > 0 || (stats?.suspicious ?? 0) > 0) {
        return { status: 'flagged', provider: 'virustotal', detail: `VirusTotal: ${stats?.malicious ?? 0} malicious, ${stats?.suspicious ?? 0} suspicious detections.` };
      }
      return { status: 'clean', provider: 'virustotal', detail: 'VirusTotal: no malicious/suspicious detections on a known file.' };
    }
    if (lookup.status !== 404) {
      return { status: 'pending', provider: 'virustotal', detail: `VirusTotal lookup failed (${lookup.status}) — will re-check via the daily scan sweep.` };
    }

    // Unknown file — submit for analysis, but never wait for it to finish
    // (VT scans can take minutes; not viable synchronously on a serverless
    // function). Comes back 'pending'; the daily automations cron re-checks.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), filename);
    const submit = await fetch(`${VT_BASE}/files`, { method: 'POST', headers: { 'x-apikey': apiKey }, body: form });
    if (!submit.ok) {
      return { status: 'pending', provider: 'virustotal', detail: `VirusTotal submission failed (${submit.status}) — will retry via the daily scan sweep.` };
    }
    return { status: 'pending', provider: 'virustotal', detail: 'New file submitted to VirusTotal — no verdict yet, re-checked by the daily scan sweep.' };
  } catch (e) {
    return { status: 'pending', provider: 'virustotal', detail: `VirusTotal call errored (${(e as Error).message}) — will retry via the daily scan sweep.` };
  }
}

// Daily cron re-check (Prompt 301 §3) — for a document still 'pending',
// just re-does the hash lookup (near-instant, no re-submission) to see if
// VT has resolved it since. Never re-submits — that already happened once.
export async function recheckPendingScan(sha256: string): Promise<ScanVerdict | null> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return null;
  try {
    const lookup = await fetch(`${VT_BASE}/files/${sha256}`, { headers: { 'x-apikey': apiKey } });
    if (!lookup.ok) return null;
    const body = await lookup.json();
    const stats = body?.data?.attributes?.last_analysis_stats as { malicious?: number; suspicious?: number } | undefined;
    if (stats == null) return null;
    if ((stats.malicious ?? 0) > 0 || (stats.suspicious ?? 0) > 0) {
      return { status: 'flagged', provider: 'virustotal', detail: `VirusTotal: ${stats.malicious ?? 0} malicious, ${stats.suspicious ?? 0} suspicious detections.` };
    }
    return { status: 'clean', provider: 'virustotal', detail: 'VirusTotal: resolved clean on re-check.' };
  } catch {
    return null;
  }
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Prompt 301 §3 — daily cron sweep (piggybacked on /api/automations, same
// Hobby-plan 1x/day constraint every other job here already respects).
// Only re-does the cheap hash LOOKUP, never re-submits (that already
// happened once, at upload time) — a file VT still hasn't resolved just
// stays 'pending' for another day.
export async function recheckPendingMalwareScans(admin: SupabaseClient): Promise<{ checked: number; resolved: number; flagged: number }> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return { checked: 0, resolved: 0, flagged: 0 };

  const { data: pending } = await admin.from('document_versions')
    .select('id, document_id, storage_path, content_sha256').eq('malware_scan_status', 'pending').limit(200);
  let resolved = 0, flagged = 0;
  const now = new Date().toISOString();
  for (const v of pending ?? []) {
    const hash = v.content_sha256 as string | null;
    if (!hash) continue;
    const verdict = await recheckPendingScan(hash);
    if (!verdict || verdict.status === 'pending') continue;
    resolved++;
    if (verdict.status === 'flagged') flagged++;
    await admin.from('document_versions').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now,
    }).eq('id', v.id as string);
    // Only mirror onto documents when this version is still the CURRENT one
    // — an older version resolving late shouldn't touch the live document's
    // own (separately tracked) status.
    await admin.from('documents').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now,
    }).eq('id', v.document_id as string).eq('storage_path', v.storage_path as string);
  }
  return { checked: (pending ?? []).length, resolved, flagged };
}
