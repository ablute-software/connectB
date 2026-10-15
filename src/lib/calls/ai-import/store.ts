// Prompt 909 (I4) — the Supabase side of the import from documents: the promoter's documents stored in the call
// ("Source documents", visible to the team, deletable), and the runs (what was proposed, what it cost, who imported,
// whether it was applied). Service role: callers have already authorised the request.
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Proposal } from './proposal';
import type { FileFormat, SourceKind } from './limits';

type Row = Record<string, unknown>;
const BUCKET = 'data-room';

export interface SourceDocument { id: string; kind: SourceKind; fileName: string; mimeType: string; sizeBytes: number; pages: number | null; uploadedBy: string; createdAt: string; publicToApplicants: boolean }
export type RunStatus = 'reading' | 'proposed' | 'applied' | 'discarded' | 'failed';
export interface ImportRun {
  id: string; status: RunStatus; proposal: Proposal; foundLater: Proposal['foundLater'];
  sourceDocumentIds: string[]; model: string | null; tokensIn: number | null; tokensOut: number | null; costEur: number | null;
  createdBy: string; createdAt: string; appliedAt: string | null;
  /** Adenda 2: why a run failed (a sentence for the person, and a short code for us), how long it took, how big the files were. */
  errorCode: string | null; errorMessage: string | null; durationMs: number | null; sourceBytes: number | null; finishedAt: string | null;
}
/** A run still "reading" after this long is not going to finish (the function that owned it is gone): it is closed as failed on the next look. */
export const READING_STALE_MS = 6 * 60 * 1000;
export const STALE_MESSAGE = 'Reading the documents took longer than we allow, so it was stopped. Please try again; a shorter document (or one document at a time) is faster.';
const EMPTY_FOUND: Proposal['foundLater'] = { eligibility: [], evaluation: [] };

const MIME: Record<FileFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const toDoc = (r: Row): SourceDocument => ({
  id: r.id as string, kind: r.kind as SourceKind, fileName: r.file_name as string, mimeType: r.mime_type as string, sizeBytes: Number(r.size_bytes),
  pages: r.pages == null ? null : Number(r.pages), uploadedBy: r.uploaded_by as string, createdAt: r.created_at as string,
  publicToApplicants: r.public_to_applicants === true,
});
const toRun = (r: Row): ImportRun => ({
  id: r.id as string, status: r.status as ImportRun['status'], proposal: r.proposal as Proposal,
  foundLater: { eligibility: (r.found_later as Partial<Proposal['foundLater']> | null)?.eligibility ?? [], evaluation: (r.found_later as Partial<Proposal['foundLater']> | null)?.evaluation ?? [] },
  sourceDocumentIds: (r.source_document_ids as string[]) ?? [], model: (r.model as string | null) ?? null,
  tokensIn: r.tokens_in == null ? null : Number(r.tokens_in), tokensOut: r.tokens_out == null ? null : Number(r.tokens_out), costEur: r.cost_eur == null ? null : Number(r.cost_eur),
  createdBy: r.created_by as string, createdAt: r.created_at as string, appliedAt: (r.applied_at as string | null) ?? null,
  errorCode: (r.error_code as string | null) ?? null, errorMessage: (r.error_message as string | null) ?? null,
  durationMs: r.duration_ms == null ? null : Number(r.duration_ms), sourceBytes: r.source_bytes == null ? null : Number(r.source_bytes), finishedAt: (r.finished_at as string | null) ?? null,
});

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'document';

export async function saveSourceDocument(
  admin: SupabaseClient, callId: string, d: { kind: SourceKind; format: FileFormat; fileName: string; bytes: Buffer; pages: number | null }, userId: string,
): Promise<SourceDocument | null> {
  const path = `calls/${callId}/${randomUUID()}-${safeName(d.fileName)}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, d.bytes, { contentType: MIME[d.format], upsert: false });
  if (upErr) return null;
  const { data, error } = await admin.from('call_source_documents').insert({
    call_id: callId, kind: d.kind, file_name: d.fileName.slice(0, 200), mime_type: MIME[d.format], size_bytes: d.bytes.length, pages: d.pages, storage_path: path, uploaded_by: userId,
  }).select('*').single();
  if (error || !data) { await admin.storage.from(BUCKET).remove([path]); return null; }
  return toDoc(data as Row);
}

/**
 * Prompt 907 (I1): show a regulation PDF to applicants on the call's link. Only a PDF of kind "regulation" can be public — a previous
 * form or an evaluation grid is the team's own working material. One regulation is public at a time (the newest choice wins).
 */
export async function setSourcePublic(admin: SupabaseClient, callId: string, docId: string, pub: boolean): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_a_regulation_pdf' }> {
  const { data } = await admin.from('call_source_documents').select('id, kind, mime_type').eq('id', docId).eq('call_id', callId).maybeSingle();
  const row = data as { kind: string; mime_type: string } | null;
  if (!row) return { ok: false, reason: 'not_found' };
  if (pub && (row.kind !== 'regulation' || row.mime_type !== 'application/pdf')) return { ok: false, reason: 'not_a_regulation_pdf' };
  if (pub) await admin.from('call_source_documents').update({ public_to_applicants: false }).eq('call_id', callId).neq('id', docId);
  await admin.from('call_source_documents').update({ public_to_applicants: pub }).eq('id', docId).eq('call_id', callId);
  return { ok: true };
}

export async function listSourceDocuments(admin: SupabaseClient, callId: string): Promise<SourceDocument[]> {
  const { data } = await admin.from('call_source_documents').select('*').eq('call_id', callId).order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map(toDoc);
}

export async function deleteSourceDocument(admin: SupabaseClient, callId: string, docId: string): Promise<SourceDocument | null> {
  const { data } = await admin.from('call_source_documents').select('*').eq('id', docId).eq('call_id', callId).maybeSingle();
  if (!data) return null;
  await admin.storage.from(BUCKET).remove([(data as Row).storage_path as string]);
  await admin.from('call_source_documents').delete().eq('id', docId).eq('call_id', callId);
  return toDoc(data as Row);
}

/** The run is born "reading": the route answers with it at once and the model works after the response. */
export async function createReadingRun(
  admin: SupabaseClient, callId: string, r: { sourceDocumentIds: string[]; sourceBytes: number; userId: string },
): Promise<ImportRun | null> {
  const { data, error } = await admin.from('call_import_runs').insert({
    call_id: callId, source_document_ids: r.sourceDocumentIds, status: 'reading', proposal: {}, found_later: EMPTY_FOUND, source_bytes: r.sourceBytes, created_by: r.userId,
  }).select('*').single();
  return error || !data ? null : toRun(data as Row);
}

/** reading -> proposed, once (compare-and-swap on the status: a run that was closed meanwhile is not resurrected). */
export async function finishRunProposed(
  admin: SupabaseClient, runId: string,
  r: { proposal: Proposal; model: string; tokensIn: number | null; tokensOut: number | null; costEur: number; durationMs: number },
): Promise<ImportRun | null> {
  const { data } = await admin.from('call_import_runs').update({
    status: 'proposed', proposal: r.proposal, found_later: r.proposal.foundLater, model: r.model, tokens_in: r.tokensIn, tokens_out: r.tokensOut,
    cost_eur: Math.round(r.costEur * 10000) / 10000, duration_ms: r.durationMs, finished_at: new Date().toISOString(),
  }).eq('id', runId).eq('status', 'reading').select('*');
  const row = ((data ?? []) as Row[])[0];
  return row ? toRun(row) : null;
}

/** reading -> failed, once: the sentence the person sees, a short code for us, how long it took. */
export async function finishRunFailed(
  admin: SupabaseClient, runId: string, r: { code: string; message: string; durationMs: number | null },
): Promise<boolean> {
  const { data } = await admin.from('call_import_runs').update({
    status: 'failed', error_code: r.code, error_message: r.message.slice(0, 500), duration_ms: r.durationMs, finished_at: new Date().toISOString(),
  }).eq('id', runId).eq('status', 'reading').select('id');
  return (data ?? []).length > 0;
}

/**
 * A run that has been "reading" for longer than any function could have been alive was cut off (the platform killed it, or it crashed):
 * close it as failed so the screen does not wait for ever. Returns the runs it closed.
 */
export async function expireStaleRuns(admin: SupabaseClient, callId: string, now: Date = new Date()): Promise<ImportRun[]> {
  const { data } = await admin.from('call_import_runs').select('*').eq('call_id', callId).eq('status', 'reading');
  const closed: ImportRun[] = [];
  for (const row of (data ?? []) as Row[]) {
    const run = toRun(row);
    const age = now.getTime() - Date.parse(run.createdAt);
    if (!Number.isFinite(age) || age <= READING_STALE_MS) continue;       // no readable start time: never guess a run dead
    if (await finishRunFailed(admin, run.id, { code: 'timed_out', message: STALE_MESSAGE, durationMs: age })) closed.push({ ...run, status: 'failed', errorCode: 'timed_out', errorMessage: STALE_MESSAGE, durationMs: age });
  }
  return closed;
}

export async function loadRun(admin: SupabaseClient, callId: string, runId: string): Promise<ImportRun | null> {
  const { data } = await admin.from('call_import_runs').select('*').eq('id', runId).eq('call_id', callId).maybeSingle();
  return data ? toRun(data as Row) : null;
}

export async function listRuns(admin: SupabaseClient, callId: string): Promise<ImportRun[]> {
  const { data } = await admin.from('call_import_runs').select('*').eq('call_id', callId).order('created_at', { ascending: false }).limit(20);
  return ((data ?? []) as Row[]).map(toRun);
}

/** compare-and-swap on the status: a run is applied or discarded once. */
export async function closeRun(admin: SupabaseClient, runId: string, status: 'applied' | 'discarded', userId: string): Promise<boolean> {
  const { data } = await admin.from('call_import_runs')
    .update({ status, applied_at: status === 'applied' ? new Date().toISOString() : null, applied_by: status === 'applied' ? userId : null })
    .eq('id', runId).eq('status', 'proposed').select('id');
  return (data ?? []).length > 0;
}
