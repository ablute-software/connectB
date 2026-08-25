// Prompt 375 — the CORRECTED one-off retro-scan, replacing the Prompt 369
// version entirely (which submitted file content on an unknown hash — see
// upload-security.ts's own header for why that's now permanently removed).
// This does ONLY a SHA-256 hash lookup per file — never a POST with file
// bytes. A private document's hash will almost always be unknown to VT
// (404), which resolves to 'local_only' — the honest, expected outcome,
// not a failure.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const vtKey = env.VIRUSTOTAL_API_KEY; // optional — hash-only mode works with or without it

const ORG_ID = 'bca54499-03c8-469b-a48d-b9f442e44f69'; // ablute_
const VT_BASE = 'https://www.virustotal.com/api/v3';

// --- upload-security.ts's scanWithVirusTotal, copied verbatim (hash-only, no submission) ---
async function scanWithVirusTotal(bytes) {
  if (!vtKey) return { status: 'local_only', provider: null, detail: 'no key configured — local-only mode' };
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    const lookup = await fetch(`${VT_BASE}/files/${sha256}`, { headers: { 'x-apikey': vtKey } });
    if (lookup.ok) {
      const body = await lookup.json();
      const stats = body?.data?.attributes?.last_analysis_stats;
      if ((stats?.malicious ?? 0) > 0 || (stats?.suspicious ?? 0) > 0) {
        return { status: 'flagged', provider: 'virustotal', detail: `${stats?.malicious ?? 0} malicious, ${stats?.suspicious ?? 0} suspicious`, sha256 };
      }
      return { status: 'clean', provider: 'virustotal', detail: 'known hash, no detections', sha256 };
    }
    if (lookup.status === 404) return { status: 'local_only', provider: null, detail: 'hash unknown to VirusTotal (expected)', sha256 };
    if (lookup.status === 401 || lookup.status === 403) {
      // Prompt 372 follow-up — 'local_only', not 'not_scanned': local
      // validation (magic bytes etc.) already happened before this ever
      // ran; a broken key is a fact about the OPTIONAL external check, not
      // about the document. 'not_scanned' would feed the extraction gate's
      // refusal and quietly block the file. Kept in sync with
      // upload-security.ts's own scanWithVirusTotal.
      console.error(`VirusTotal auth failed (${lookup.status}) — check VIRUSTOTAL_API_KEY.`);
      return { status: 'local_only', provider: null, detail: `auth failed (${lookup.status}) — validated locally instead`, sha256 };
    }
    return { status: 'pending', provider: 'virustotal', detail: `temporary failure (${lookup.status})`, sha256 };
  } catch (e) {
    return { status: 'pending', provider: 'virustotal', detail: `error: ${e.message}`, sha256 };
  }
}

async function main() {
  const { data: rows, error } = await admin.from('document_versions')
    .select('id, document_id, storage_path')
    .eq('org_id', ORG_ID).eq('malware_scan_status', 'not_scanned');
  if (error) throw error;

  console.log(`Found ${rows.length} document_versions rows to scan for ablute_ (hash-only, no file content ever sent).`);
  console.log(vtKey ? 'VIRUSTOTAL_API_KEY is set — will do a hash lookup per file.' : 'No VIRUSTOTAL_API_KEY — every file resolves to local_only directly, no network calls.');

  const results = { clean: 0, local_only: 0, authFailedLocalOnly: 0, flagged: [], pending: 0, skipped: [] };
  let i = 0;
  for (const v of rows) {
    i++;
    if (!v.storage_path) { results.skipped.push({ id: v.id, reason: 'no storage_path (external link)' }); continue; }
    process.stdout.write(`[${i}/${rows.length}] ${v.storage_path} … `);
    const { data: blob, error: dlError } = await admin.storage.from('data-room').download(v.storage_path);
    if (dlError || !blob) { results.skipped.push({ id: v.id, storagePath: v.storage_path, reason: `download failed: ${dlError?.message}` }); console.log('DOWNLOAD FAILED'); continue; }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const verdict = await scanWithVirusTotal(bytes);
    console.log(verdict.status.toUpperCase());

    const now = new Date().toISOString();
    await admin.from('document_versions').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now,
      malware_scan_provider: verdict.provider, content_sha256: sha256,
    }).eq('id', v.id);
    await admin.from('documents').update({
      malware_scan_status: verdict.status, malware_scan_checked_at: now, malware_scan_provider: verdict.provider,
    }).eq('id', v.document_id).eq('storage_path', v.storage_path);

    if (verdict.status === 'clean') results.clean++;
    else if (verdict.status === 'local_only') {
      results.local_only++;
      if (verdict.detail.includes('auth failed')) results.authFailedLocalOnly++;
    }
    else if (verdict.status === 'flagged') results.flagged.push({ storagePath: v.storage_path, detail: verdict.detail });
    else results.pending++;
  }

  console.log('\n=== Hash-only retro-scan complete ===');
  console.log(`local_only (validated locally, never submitted): ${results.local_only}`);
  console.log(`  — of which via a VirusTotal AUTH FAILURE (check VIRUSTOTAL_API_KEY — still local_only, never blocked): ${results.authFailedLocalOnly}`);
  console.log(`clean (already known to VT, no detections): ${results.clean}`);
  console.log(`flagged: ${results.flagged.length}`);
  if (results.flagged.length) console.log(JSON.stringify(results.flagged, null, 2));
  console.log(`pending (temporary VT failure — cron will retry): ${results.pending}`);
  console.log(`skipped: ${results.skipped.length}`);
  if (results.skipped.length) console.log(JSON.stringify(results.skipped, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
