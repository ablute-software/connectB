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

// Prompt 305 §A — gif/webp added alongside jpg/png: support-attachment and
// matchdeal-photo uploads both accepted any `image/*` MIME type before this
// (client-supplied, trivially spoofable), which in practice meant common
// screenshot/photo formats beyond jpg/png. Deliberately still NO svg — an
// SVG is XML that CAN embed <script>; the app's own renderers only ever use
// it via <img src> (confirmed by grep — sandboxed, scripts don't execute
// there), but the signed URL Storage hands back is a plain HTTPS link
// nothing stops someone from opening directly, where a top-level SVG
// document's script WOULD run. Building a real SVG sanitizer (strip
// <script>, on*= handlers, external entities, <foreignObject>) is a
// separate, easy-to-get-wrong undertaking; a profile photo has no genuine
// need to be a vector graphic, so the simplest correct fix is to just not
// allow it through this allowlist at all, for every caller.
// Prompt 353 — mp4/webm added for the company media gallery's own video
// uploads (never any other caller's allowlist — the ext->kind map below is
// what actually gates which callers can even ask for these).
export type AllowedFileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls' | 'ppt' | 'jpg' | 'png' | 'gif' | 'webp' | 'csv' | 'txt' | 'md' | 'mp4' | 'webm';

const EXT_KIND: Record<string, AllowedFileKind> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'doc', xls: 'xls', ppt: 'ppt',
  jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', csv: 'csv', txt: 'txt', md: 'md',
  mp4: 'mp4', webm: 'webm',
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
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) return expectedKind === 'gif' ? 'gif' : null; // GIF8(7a|9a)
  if (bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return expectedKind === 'webp' ? 'webp' : null; // RIFF....WEBP — bytes 4-7 are a file-size field, skipped
  }
  if ((expectedKind === 'csv' || expectedKind === 'txt' || expectedKind === 'md') && looksLikeText(bytes)) return expectedKind;
  // Prompt 353 — MP4: an `ftyp` box at byte offset 4 (the preceding 4 bytes
  // are a box-size field that varies per file, never a fixed signature).
  // WebM/Matroska: the EBML header magic number.
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return expectedKind === 'mp4' ? 'mp4' : null;
  }
  if (bytesStartWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return expectedKind === 'webm' ? 'webm' : null;
  return null;
}

// Prompt 375 — REPLACES the original submission strategy entirely, dated
// 25/08/2026. This app is a Data Room: every file is confidential by
// definition. VirusTotal's free/public API shares submitted file CONTENT
// with the security industry — that's the exact reason VT sells a separate
// paid "Private Scanning" product for anyone who doesn't want that shared.
// Do NOT reintroduce a `POST /files` (or any body containing file bytes)
// call here, however convenient it looks later — a confirmed incident
// (Prompt 375) caught this about to happen for real: an invalid API key
// accidentally prevented 65 real founder documents (contracts, a patent,
// CVs with personal data) from being uploaded to VT's public feed, purely
// by accident. The fix is not "use a working key" — it's "never submit
// content at all." Only a SHA-256 hash — which reveals nothing about the
// file's content — ever leaves this app toward VirusTotal.
//
// 'local_only' is the new, honest default outcome for a private document
// VT has never seen (which is nearly always, for founder-specific files):
// validated locally (magic bytes via detectAllowedKind, declared type
// matches content, size within limits), no external verdict, because the
// file was never shared to get one. 'flagged' still exists and still
// blocks — a KNOWN-malicious hash is caught by the lookup alone, without
// this app ever handing VT anything.
export type ScanVerdict = { status: 'clean' | 'local_only' | 'flagged' | 'pending' | 'not_scanned'; provider: string | null; detail: string };

const VT_BASE = 'https://www.virustotal.com/api/v3';

export async function scanWithVirusTotal(bytes: Buffer): Promise<ScanVerdict> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) {
    return { status: 'local_only', provider: null, detail: 'VIRUSTOTAL_API_KEY not configured — local magic-byte validation only (by design: this app never submits file content externally).' };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  try {
    const lookup = await fetch(`${VT_BASE}/files/${sha256}`, { headers: { 'x-apikey': apiKey } });
    if (lookup.ok) {
      const body = await lookup.json();
      const stats = body?.data?.attributes?.last_analysis_stats as { malicious?: number; suspicious?: number } | undefined;
      if ((stats?.malicious ?? 0) > 0 || (stats?.suspicious ?? 0) > 0) {
        return { status: 'flagged', provider: 'virustotal', detail: `VirusTotal: ${stats?.malicious ?? 0} malicious, ${stats?.suspicious ?? 0} suspicious detections on a hash VT already knew.` };
      }
      return { status: 'clean', provider: 'virustotal', detail: 'VirusTotal: this exact file hash is already known and has no malicious/suspicious detections.' };
    }
    if (lookup.status === 404) {
      // The normal case for a private, founder-specific file: VT has never
      // seen this hash. This is NOT a failure — it's expected, and it's
      // exactly why this app never submits it to find out more.
      return { status: 'local_only', provider: null, detail: 'Hash unknown to VirusTotal (expected for a private document) — validated locally, never submitted.' };
    }
    if (lookup.status === 401 || lookup.status === 403) {
      // Prompt 375 §B — a config error, never "pending". Pending implies
      // "VT is thinking about it"; 401/403 means the call never got past
      // our own front door. Silently degrading this to 'pending' is what
      // caused the exact incident this prompt fixes — the daily cron would
      // have re-tried the same broken credentials forever, reporting
      // nothing wrong, while looking like a real scan was in progress.
      //
      // Prompt 372 follow-up — the STATUS this resolves to is 'local_only',
      // not 'not_scanned'. By the time this function runs, the caller has
      // already passed local validation (detectAllowedKind — magic bytes,
      // declared type, size); a broken/expired/revoked VIRUSTOTAL_API_KEY
      // is a fact about the OPTIONAL external check, not about whether the
      // document itself was validated. 'not_scanned' feeds
      // prepareDocumentForAi's gate, which refuses it — so marking an
      // auth failure 'not_scanned' would mean a key that quietly expires
      // one day silently stops the entire knowledge engine, platform-wide,
      // for every NEW upload from that moment on, with the loud log/
      // backoffice signal below as the only trace. The auth failure stays
      // exactly as loud; the document's own status reflects what actually
      // happened to IT (locally validated, never externally verified).
      console.error(`[upload-security] VirusTotal auth failed (${lookup.status}) — check VIRUSTOTAL_API_KEY. Falling back to local-only validation.`);
      return { status: 'local_only', provider: null, detail: `VirusTotal authentication failed (${lookup.status}) — scanner misconfigured; validated locally instead.` };
    }
    // 429 (rate limit) / 5xx — a real, legitimate "try again later" from
    // VT's own infrastructure, worth the daily cron's cheap re-lookup.
    return { status: 'pending', provider: 'virustotal', detail: `VirusTotal lookup temporarily failed (${lookup.status}) — will re-check via the daily scan sweep.` };
  } catch (e) {
    return { status: 'pending', provider: 'virustotal', detail: `VirusTotal call errored (${(e as Error).message}) — will retry via the daily scan sweep.` };
  }
}

// Prompt 375 — a live, on-demand check of whether VIRUSTOTAL_API_KEY
// actually authenticates, for the backoffice "scanner health" signal
// (never silent — see scanWithVirusTotal's own 401/403 handling above).
// Uses the SHA-256 of an empty buffer, a hash VT is guaranteed to have an
// opinion on either way (known-empty-file entries exist in most AV
// corpora) — this is a credential check, not a real document scan, and
// sends no file content of any kind.
export async function checkVirusTotalKeyHealth(): Promise<{ configured: boolean; ok: boolean; detail: string }> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return { configured: false, ok: false, detail: 'VIRUSTOTAL_API_KEY is not set — running in local-only mode by design.' };
  const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  try {
    const res = await fetch(`${VT_BASE}/files/${emptyHash}`, { headers: { 'x-apikey': apiKey } });
    if (res.status === 401 || res.status === 403) return { configured: true, ok: false, detail: `VirusTotal rejected the configured key (HTTP ${res.status}).` };
    if (res.ok || res.status === 404) return { configured: true, ok: true, detail: 'VirusTotal key authenticates correctly.' };
    return { configured: true, ok: false, detail: `Unexpected VirusTotal response (HTTP ${res.status}).` };
  } catch (e) {
    return { configured: true, ok: false, detail: `Could not reach VirusTotal: ${(e as Error).message}` };
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

// Prompt 305 §A — generic version of the same sweep for the four secondary
// upload paths (investor_verification_documents, ndas, matchdeal_profiles'
// single photo, support_attachment_scans), each with its own table/column
// names but identical status semantics. Kept separate from
// recheckPendingMalwareScans (document_versions) rather than generalizing
// that one too — its "mirror onto documents" step has no equivalent here.
export interface ScanColumnConfig {
  table: string;
  idColumn: string;
  hashColumn: string;
  statusColumn: string;
  checkedAtColumn: string;
  // Extra columns to select for logging/context only — never required.
  extraSelect?: string[];
}

// matchdeal_profiles is a special case among the four: photo_url is a raw,
// long-lived (10-year) signed URL, stored verbatim and read DIRECTLY by
// client components (MatchDealDeck/MatchesPanel/InstantMessagePanel) via
// RLS — there's no backoffice route in the middle to gate a signed-url
// generation the way the other three secondary paths (and the Vault's own
// document-serving routes) have. So when this one resolves to 'flagged'
// after the fact, the mitigation is different: delete the Storage object
// (the existing signed URL 404s) and clear photo_url so the profile falls
// back to its initials/gradient placeholder, same as "no photo set".
// Known limitation, stated plainly: matchdeal_profiles tracks only the
// CURRENT photo's hash/path (no version history) — if a founder/investor
// uploads a second photo before the first one's VT verdict resolves, the
// first upload's tracking is silently overwritten and this sweep can no
// longer find or act on it. Accepted rather than building a version-history
// table for a profile photo; the synchronous magic-byte + known-malicious
// checks at upload time are what carry the real weight here regardless.
export async function recheckMatchdealPhotoScans(admin: SupabaseClient): Promise<{ checked: number; resolved: number; flagged: number }> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return { checked: 0, resolved: 0, flagged: 0 };

  const { data: pending } = await admin.from('matchdeal_profiles')
    .select('id, photo_content_sha256, photo_storage_path').eq('photo_malware_scan_status', 'pending').limit(200);
  let resolved = 0, flagged = 0;
  const now = new Date().toISOString();
  for (const row of pending ?? []) {
    const hash = row.photo_content_sha256 as string | null;
    if (!hash) continue;
    const verdict = await recheckPendingScan(hash);
    if (!verdict || verdict.status === 'pending') continue;
    resolved++;
    if (verdict.status === 'flagged') {
      flagged++;
      const storagePath = row.photo_storage_path as string | null;
      if (storagePath) await admin.storage.from('data-room').remove([storagePath]);
      await admin.from('matchdeal_profiles').update({
        photo_malware_scan_status: 'flagged', photo_scan_checked_at: now, photo_url: null, photo_storage_path: null,
      }).eq('id', row.id as string);
    } else {
      await admin.from('matchdeal_profiles').update({
        photo_malware_scan_status: verdict.status, photo_scan_checked_at: now,
      }).eq('id', row.id as string);
    }
  }
  return { checked: (pending ?? []).length, resolved, flagged };
}

export async function recheckPendingScansGeneric(admin: SupabaseClient, config: ScanColumnConfig): Promise<{ checked: number; resolved: number; flagged: number }> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return { checked: 0, resolved: 0, flagged: 0 };

  const selectCols = [config.idColumn, config.hashColumn, ...(config.extraSelect ?? [])].join(', ');
  const { data: pending } = await admin.from(config.table)
    .select(selectCols).eq(config.statusColumn, 'pending').limit(200);
  let resolved = 0, flagged = 0;
  const now = new Date().toISOString();
  for (const row of (pending ?? []) as unknown as Record<string, unknown>[]) {
    const hash = row[config.hashColumn] as string | null;
    if (!hash) continue;
    const verdict = await recheckPendingScan(hash);
    if (!verdict || verdict.status === 'pending') continue;
    resolved++;
    if (verdict.status === 'flagged') flagged++;
    await admin.from(config.table).update({
      [config.statusColumn]: verdict.status, [config.checkedAtColumn]: now,
    }).eq(config.idColumn, row[config.idColumn] as string);
  }
  return { checked: (pending ?? []).length, resolved, flagged };
}

// Prompt 301 §3 — daily cron sweep (piggybacked on /api/automations, same
// Hobby-plan 1x/day constraint every other job here already respects).
// Only re-does the cheap hash LOOKUP, never re-submits (that already
// happened once, at upload time) — a file VT still hasn't resolved just
// stays 'pending' for another day.
// Prompt 369 §A3 — the gap the retro-scan fixed once should never reopen:
// migration 0205 marked every pre-existing document_versions row
// 'not_scanned' ("never claim retroactive safety" — the right call), but
// nothing EVER scanned them afterward — recheckPendingMalwareScans above
// only re-checks rows already 'pending' (a cheap hash lookup; they were
// already downloaded and hashed once, at upload time). A 'not_scanned' row
// has no content_sha256 yet, so it needs the FULL scan (download + magic
// bytes + VirusTotal), not just a re-lookup — this is that path, small and
// rate-limited (default 10/day) so a bulk-imported org's backlog drains
// gradually via the existing daily cron rather than needing a second
// manual one-off script the next time this happens. detectAllowedKind is
// deliberately NOT enforced here (unlike verify-upload's synchronous
// upload-time gate) — these are already-served, already-trusted historical
// files; a kind mismatch on an old file is a data-quality question for
// another day, not grounds to delete something a founder has been relying
// on. Malware is the one thing this pass acts on.
export async function retroscanNotScannedDocuments(admin: SupabaseClient, limit = 10): Promise<{ checked: number; resolved: number; flagged: number }> {
  // Prompt 375 — no early return on a missing API key: hash-only mode
  // works (and is the honest default) with or without VIRUSTOTAL_API_KEY —
  // scanWithVirusTotal itself degrades to 'local_only' either way, never
  // sending file content regardless of key state.
  const { data: rows } = await admin.from('document_versions')
    .select('id, document_id, storage_path').eq('malware_scan_status', 'not_scanned').limit(limit);
  let resolved = 0, flagged = 0;
  const now = new Date().toISOString();
  for (const v of rows ?? []) {
    const storagePath = v.storage_path as string | null;
    if (!storagePath) continue;
    const { data: blob, error } = await admin.storage.from('data-room').download(storagePath);
    if (error || !blob) continue;
    const bytes = Buffer.from(await blob.arrayBuffer());
    const verdict = await scanWithVirusTotal(bytes);
    const sha256 = sha256Hex(bytes);
    resolved++;
    if (verdict.status === 'flagged') flagged++;
    await admin.from('document_versions').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now,
      malware_scan_provider: verdict.provider, content_sha256: sha256,
    }).eq('id', v.id as string);
    // Prompt 375 §B — the mirror now writes `malware_scan_provider` too,
    // never just status/checked_at: the original omission is exactly what
    // produced documents.provider=NULL next to
    // document_versions.provider='virustotal' for the SAME 65 rows.
    await admin.from('documents').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now, malware_scan_provider: verdict.provider,
    }).eq('id', v.document_id as string).eq('storage_path', storagePath);
  }
  return { checked: (rows ?? []).length, resolved, flagged };
}

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
