// Prompt 462 §C — Fase 1a: turns a document-link (documents.external_url,
// never uploaded as a file) into real bytes prepareDocumentForAi can read
// exactly like an uploaded PDF. Fetch-once: a snapshot already at
// status='ok' is served straight from Storage, never re-fetched from the
// network on every extraction — periodic re-fetch/change-detection is
// Fase 3, out of scope here.
//
// Privacy, verified before writing this: the snapshot is content the
// founder themselves already linked into their own Vault, already
// publicly reachable at its source (CLAUDE.md's root privacy rule is about
// PLATFORM-derived performance data, never content the founder supplies) —
// storing a copy doesn't expose it any more than it already was. The
// snapshot's own storage prefix (link-snapshots/) is never read by any
// portal/investor route, and the founder's original `documents` row
// (downloadable, is_view_only, storage_path) is never modified — this
// function only ever adds a NEW row in document_link_snapshots, never
// touches the founder's own document record.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256Hex, detectAllowedKind } from './upload-security';
import { fetchExternalBytes, isAllowedFetchUrl, resolveDirectDownloadUrl, type LinkFetchFailure } from './link-fetch';
import { MAX_DOWNLOAD_BYTES } from './document-extraction';

const FETCH_TIMEOUT_MS = 30_000;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;

export type LinkSnapshotFailure = LinkFetchFailure | 'not_found' | 'not_a_supported_file' | 'storage_upload_failed';

async function recordFailure(
  admin: SupabaseClient, orgId: string, documentId: string, sourceUrl: string, reason: LinkSnapshotFailure,
): Promise<void> {
  await admin.from('document_link_snapshots').upsert({
    org_id: orgId, document_id: documentId, source_url: sourceUrl,
    storage_path: null, sha256: null, bytes: null, detected_kind: null,
    status: 'failed', failure_reason: reason, fetched_at: new Date().toISOString(),
  }, { onConflict: 'document_id' });
}

// Prompt 462 §C.4 — the document's own name has no extension by
// construction for a link (a Drive share title, e.g. "ablute_ investor
// deck"), so the fallback chain matters: it only changes WHICH expected
// kind detectAllowedKind cross-checks the real magic bytes against, never
// whether the check itself runs. Same regex/shape as new-version-from-
// link/route.ts's own fileNameFromUrl, reused here for the same reason.
function pickNameHint(documentName: string, finalUrl: string): string {
  if (HAS_EXTENSION.test(documentName)) return documentName;
  try {
    const last = new URL(finalUrl).pathname.split('/').filter(Boolean).pop();
    if (last && HAS_EXTENSION.test(last)) return last;
  } catch {
    // Malformed finalUrl — fall through to the default below.
  }
  return 'link.pdf';
}

export async function ensureLinkSnapshot(
  admin: SupabaseClient, orgId: string, documentId: string,
): Promise<{ ok: true; storagePath: string; sha256: string; bytes: Buffer } | { ok: false; reason: LinkSnapshotFailure }> {
  const { data: doc } = await admin.from('documents')
    .select('id, name, external_url').eq('id', documentId).eq('org_id', orgId).maybeSingle();
  const docRow = doc as { id: string; name: string; external_url: string | null } | null;
  if (!docRow) return { ok: false, reason: 'not_found' };

  const sourceUrl = docRow.external_url ?? '';
  const directUrl = docRow.external_url ? resolveDirectDownloadUrl(docRow.external_url) : null;
  if (!directUrl || !isAllowedFetchUrl(directUrl)) {
    await recordFailure(admin, orgId, documentId, sourceUrl, 'host_not_allowed');
    return { ok: false, reason: 'host_not_allowed' };
  }

  // Prompt 462 §C.2 — fetch-once: an existing 'ok' snapshot is served from
  // Storage, never re-fetched from the network.
  const { data: existing } = await admin.from('document_link_snapshots')
    .select('storage_path, sha256, status').eq('document_id', documentId).maybeSingle();
  if (existing?.status === 'ok' && existing.storage_path && existing.sha256) {
    const { data: blob, error: dlError } = await admin.storage.from('data-room').download(existing.storage_path);
    if (!dlError && blob) {
      return { ok: true, storagePath: existing.storage_path, sha256: existing.sha256 as string, bytes: Buffer.from(await blob.arrayBuffer()) };
    }
    // The Storage object is gone even though the row says 'ok' — fall
    // through and re-fetch rather than returning a false failure forever.
  }

  const fetched = await fetchExternalBytes(directUrl, { maxBytes: MAX_DOWNLOAD_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
  if (!fetched.ok) {
    await recordFailure(admin, orgId, documentId, sourceUrl, fetched.reason);
    return { ok: false, reason: fetched.reason };
  }

  // Prompt 462 §C.4 — this is the ONE check that catches the interstitial
  // HTML case (Drive's "Demonstrator" — a 200 whose body is a virus-scan
  // warning page, not the file): HTTP status and Content-Type never
  // distinguish it, only the real magic bytes do. Only 'pdf' is accepted
  // in this slice; any other detected kind (or none) is
  // 'not_a_supported_file' — the remaining formats are Fase 5.
  const nameHint = pickNameHint(docRow.name, fetched.finalUrl);
  const kind = detectAllowedKind(fetched.bytes, nameHint);
  if (kind !== 'pdf') {
    await recordFailure(admin, orgId, documentId, sourceUrl, 'not_a_supported_file');
    return { ok: false, reason: 'not_a_supported_file' };
  }

  // Prompt 462 §C.5 — its own prefix, on purpose: no portal/investor route
  // ever reads from link-snapshots/, so this can never become a download
  // path for an investor. The founder's own documents row (downloadable,
  // is_view_only, storage_path) is never touched.
  const storagePath = `link-snapshots/${orgId}/${documentId}.pdf`;
  const { error: uploadError } = await admin.storage.from('data-room')
    .upload(storagePath, fetched.bytes, { upsert: true, contentType: 'application/pdf' });
  if (uploadError) {
    await recordFailure(admin, orgId, documentId, sourceUrl, 'storage_upload_failed');
    return { ok: false, reason: 'storage_upload_failed' };
  }

  const sha256 = sha256Hex(fetched.bytes);
  await admin.from('document_link_snapshots').upsert({
    org_id: orgId, document_id: documentId, source_url: sourceUrl,
    storage_path: storagePath, sha256, bytes: fetched.bytes.length, detected_kind: kind,
    status: 'ok', failure_reason: null, fetched_at: new Date().toISOString(),
  }, { onConflict: 'document_id' });

  return { ok: true, storagePath, sha256, bytes: fetched.bytes };
}
