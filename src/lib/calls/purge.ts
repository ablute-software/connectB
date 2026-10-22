// Prompt 918 (Adenda 2, C) — the end of the 30 days: a deleted call is removed for good. Run by the daily tick (/api/automations — one cron, as on the Hobby plan, no second one).
// For every call whose `delete_purge_after` has passed: first its FILES leave Storage (what applicants uploaded, the frozen copies of what they submitted, the regulation and source documents,
// the cover and the logo — NEVER a Vault document: a Vault file attached to an application is the startup's own object and is only referenced), and only if that worked the database
// rows go (purge_deleted_call: one transaction, which also writes the minimal record that stays — the call's id and name, who deleted it, when, and the counts, never an applicant's data).
// If Storage fails, nothing is removed from the database and the call is tried again tomorrow: a purge never leaves files with nobody pointing at them.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MEDIA_BUCKET } from './branding';
import { promoterName } from './store';
import { rowToCall } from './mappers';

type Row = Record<string, unknown>;
const CHUNK = 100;

/** Every Storage path that belongs to this call and to nobody else. */
export async function storagePathsOfCall(admin: SupabaseClient, call: { id: string; coverPath?: string | null; logoPath?: string | null }): Promise<string[]> {
  const [{ data: files }, { data: docs }] = await Promise.all([
    admin.from('call_application_files').select('source, storage_path, frozen_path').eq('call_id', call.id),
    admin.from('call_source_documents').select('storage_path').eq('call_id', call.id),
  ]);
  const paths = new Set<string>();
  for (const f of (files ?? []) as Row[]) {
    // An upload lives in the applicant's own folder; a Vault file's storage_path is the VAULT's object — never ours to delete. The frozen copy is always the call's own.
    if (f.source === 'upload' && typeof f.storage_path === 'string') paths.add(f.storage_path);
    if (typeof f.frozen_path === 'string') paths.add(f.frozen_path);
  }
  for (const d of (docs ?? []) as Row[]) if (typeof d.storage_path === 'string') paths.add(d.storage_path);
  if (call.coverPath) paths.add(call.coverPath);
  if (call.logoPath) paths.add(call.logoPath);
  return [...paths];
}

export interface PurgeResult { due: number; purged: number; failed: number; filesRemoved: number }

export async function purgeDeletedCalls(admin: SupabaseClient, now: Date = new Date()): Promise<PurgeResult> {
  const { data } = await admin.from('calls').select('*').lte('delete_purge_after', now.toISOString());
  const due = ((data ?? []) as Row[]).filter((r) => r.deleted_at && r.delete_purge_after).map(rowToCall);
  const out: PurgeResult = { due: due.length, purged: 0, failed: 0, filesRemoved: 0 };
  for (const call of due) {
    try {
      const paths = await storagePathsOfCall(admin, call);
      let removedAll = true;
      for (let i = 0; i < paths.length; i += CHUNK) {
        const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + CHUNK));
        if (error) { removedAll = false; console.error(JSON.stringify({ event: 'calls_purge_storage_failed', callId: call.id, reason: error.message })); break; }
      }
      if (!removedAll) { out.failed++; continue; }
      const name = await promoterName(admin, call.promoterKind, call.promoterId);
      const { data: res, error } = await admin.rpc('purge_deleted_call', { p_call: call.id, p_promoter_name: name });
      if (error || res?.ok !== true) { out.failed++; console.error(JSON.stringify({ event: 'calls_purge_failed', callId: call.id, reason: error?.message ?? res?.reason ?? 'unknown' })); continue; }
      out.purged++; out.filesRemoved += paths.length;
    } catch (e) {
      out.failed++;
      console.error(JSON.stringify({ event: 'calls_purge_failed', callId: call.id, reason: (e as Error).message }));
    }
  }
  return out;
}
