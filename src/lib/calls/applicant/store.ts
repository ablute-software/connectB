// Prompt 907 — the Supabase side of the applicant's application: the startup behind a session, opening or resuming the draft (the
// atomic work is in SQL: call_open_application), saving it under optimistic concurrency, its files (uploaded or pinned from the Vault),
// and the state the form is rendered from. Service role: callers have already authenticated and authorised the request (the caller
// is a member of the startup that owns the application, resolved by resolveActingOrg).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Answers, Call, FormField } from '../types';
import { visiblePages } from '../form-logic';
import { sanitizeAnswers, type FileRef } from './answers';
import { prefillAnswers, profileFromRows } from './profile';
import { newReference } from './reference';
import { unitKey } from './unit';

type Row = Record<string, unknown>;

export interface ApplicationRow {
  id: string; callId: string; orgId: string | null; status: 'draft' | 'submitted' | 'withdrawn'; reference: string | null;
  answers: Answers; lastPage: number | null; revision: number; applicantUserId: string; submittedAt: string | null; currentSubmissionId: string | null; unitKey: string | null;
}

const toApplication = (r: Row): ApplicationRow => ({
  id: r.id as string, callId: r.call_id as string, orgId: (r.startup_org_id as string | null) ?? null, status: r.status as ApplicationRow['status'],
  reference: (r.reference as string | null) ?? null, answers: ((r.draft_answers as Answers | null) ?? {}) as Answers,
  lastPage: r.last_page == null ? null : Number(r.last_page), revision: Number(r.draft_revision ?? 0), applicantUserId: r.applicant_user_id as string,
  submittedAt: (r.submitted_at as string | null) ?? null, currentSubmissionId: (r.current_submission_id as string | null) ?? null, unitKey: (r.unit_key as string | null) ?? null,
});

export async function loadApplication(admin: SupabaseClient, id: string): Promise<ApplicationRow | null> {
  const { data } = await admin.from('call_applications').select('*').eq('id', id).maybeSingle();
  return data ? toApplication(data as Row) : null;
}

export async function loadOrgAndMember(admin: SupabaseClient, orgId: string, userId: string): Promise<{ org: Row | null; member: Row | null }> {
  const [{ data: org }, { data: member }] = await Promise.all([
    admin.from('orgs').select('id, name, legal_name, country, sector, stage, website').eq('id', orgId).maybeSingle(),
    admin.from('org_members').select('full_name, title').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
  ]);
  return { org: (org as Row | null) ?? null, member: (member as Row | null) ?? null };
}

/** "This startup reached this call by its link": an unlisted call then shows in its own list (§20). */
export async function recordLinkAccess(admin: SupabaseClient, callId: string, orgId: string, userId: string): Promise<void> {
  await admin.from('call_link_access').upsert({ call_id: callId, org_id: orgId, user_id: userId }, { onConflict: 'call_id,org_id', ignoreDuplicates: true });
}

export type OpenResult =
  | { ok: true; application: ApplicationRow; created: boolean }
  | { ok: false; reason: 'not_accepting' | 'unit_limit' | 'not_found' | 'error' };

/**
 * Open (or resume) the startup's application on this call. The SQL function serialises per (call, unit), checks the per-unit limit and
 * that the call accepts applications, and returns the existing application when there is one (a draft to continue, a submitted one to
 * look at). A NEW draft is pre-filled once from the platform's data; after that the answers belong to the applicant.
 */
export async function openApplication(
  admin: SupabaseClient, call: Call, fields: FormField[], orgId: string, userId: string, opts: { startNew?: boolean } = {},
): Promise<OpenResult> {
  const { org, member } = await loadOrgAndMember(admin, orgId, userId);
  if (!org) return { ok: false, reason: 'not_found' };
  const key = unitKey(call.limitUnit, { id: orgId, name: org.name, legal_name: org.legal_name, country: org.country });
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin.rpc('call_open_application', {
      p_call: call.id, p_org: orgId, p_user: userId, p_unit_key: key, p_reference: newReference(), p_new: opts.startNew === true,
    });
    // A reference collision (unique index) is retried with a new one; anything else is an error.
    if (error) { if (error.code === '23505') continue; return { ok: false, reason: 'error' }; }
    const res = data as { ok?: boolean; reason?: string; application_id?: string; created?: boolean } | null;
    if (!res?.ok || !res.application_id) {
      const reason = res?.reason === 'unit_limit' || res?.reason === 'not_accepting' || res?.reason === 'not_found' ? res.reason : 'error';
      return { ok: false, reason };
    }
    let app = await loadApplication(admin, res.application_id);
    if (!app) return { ok: false, reason: 'error' };
    if (res.created) {
      const merged = prefillAnswers(fields, profileFromRows(org, member), app.answers);
      if (JSON.stringify(merged) !== JSON.stringify(app.answers)) {
        await admin.from('call_applications').update({ draft_answers: merged, draft_revision: app.revision + 1 }).eq('id', app.id).eq('draft_revision', app.revision);
        app = (await loadApplication(admin, app.id)) ?? app;
      }
    }
    return { ok: true, application: app, created: res.created === true };
  }
  return { ok: false, reason: 'error' };
}

export type SaveResult = { ok: true; revision: number } | { ok: false; reason: 'conflict' | 'not_draft' | 'error' };

/** Save the draft: only while it is a draft, and only if nobody saved since the browser last read (compare-and-swap on the revision). */
export async function saveDraft(
  admin: SupabaseClient, app: ApplicationRow, answers: Answers, lastPage: number | null, baseRevision: number,
): Promise<SaveResult> {
  if (app.status !== 'draft') return { ok: false, reason: 'not_draft' };
  const { data, error } = await admin.from('call_applications')
    .update({ draft_answers: answers, last_page: lastPage, draft_revision: baseRevision + 1, updated_at: new Date().toISOString() })
    .eq('id', app.id).eq('status', 'draft').eq('draft_revision', baseRevision).select('draft_revision');
  if (error) return { ok: false, reason: 'error' };
  const row = (data ?? [])[0] as Row | undefined;
  return row ? { ok: true, revision: Number(row.draft_revision) } : { ok: false, reason: 'conflict' };
}

// ---- files ------------------------------------------------------------------------------------------------------------------

export interface FileRow extends FileRef {
  storagePath: string; sha256: string | null; versionId: string | null; frozenPath: string | null; revokedAt: string | null; orgId: string; fieldId: string;
}

const toFile = (r: Row): FileRow => ({
  id: r.id as string, fieldId: r.field_id as string, source: r.source as 'upload' | 'vault', fileName: r.file_name as string, size: Number(r.size_bytes),
  versionNumber: r.version_number == null ? null : Number(r.version_number), documentId: (r.document_id as string | null) ?? null, entryId: (r.entry_id as string | null) ?? null,
  storagePath: r.storage_path as string, sha256: (r.sha256 as string | null) ?? null, versionId: (r.version_id as string | null) ?? null,
  frozenPath: (r.frozen_path as string | null) ?? null, revokedAt: (r.revoked_at as string | null) ?? null, orgId: r.org_id as string,
});

export async function loadFiles(admin: SupabaseClient, applicationId: string): Promise<FileRow[]> {
  const { data } = await admin.from('call_application_files').select('*').eq('application_id', applicationId).order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map(toFile);
}

export interface VaultPdf { id: string; name: string; version: number; sizeBytes: number | null; storagePath: string; versionId: string | null; sha256: string | null }

const isPdfName = (n: unknown) => typeof n === 'string' && n.toLowerCase().endsWith('.pdf');

/** The latest version of a Vault document (its own row when it has no version rows). */
async function latestVersion(admin: SupabaseClient, doc: Row): Promise<{ version: number; storagePath: string; versionId: string | null; size: number | null; sha256: string | null }> {
  const { data } = await admin.from('document_versions').select('id, version, storage_path, size, content_sha256').eq('document_id', doc.id as string).order('version', { ascending: false }).limit(1);
  const v = ((data ?? []) as Row[])[0];
  if (v) return { version: Number(v.version), storagePath: v.storage_path as string, versionId: v.id as string, size: v.size == null ? null : Number(v.size), sha256: (v.content_sha256 as string | null) ?? null };
  return { version: Number(doc.version ?? 1), storagePath: doc.storage_path as string, versionId: null, size: null, sha256: null };
}

/** The startup's own Vault documents an applicant may attach: PDFs that are real files, not flagged by the malware scan. */
export async function listVaultPdfs(admin: SupabaseClient, orgId: string): Promise<VaultPdf[]> {
  const { data } = await admin.from('documents').select('id, name, version, storage_path, kind, external_url, malware_scan_status, deal_memo_payload').eq('org_id', orgId).order('name', { ascending: true }).limit(500);
  const docs = ((data ?? []) as Row[]).filter((d) =>
    d.storage_path && !d.external_url && !d.deal_memo_payload && d.malware_scan_status !== 'flagged' && (isPdfName(d.name) || isPdfName(d.storage_path)));
  const out: VaultPdf[] = [];
  for (const d of docs) {
    const v = await latestVersion(admin, d);
    if (!isPdfName(v.storagePath) && !isPdfName(d.name)) continue;
    out.push({ id: d.id as string, name: d.name as string, version: v.version, sizeBytes: v.size, storagePath: v.storagePath, versionId: v.versionId, sha256: v.sha256 });
  }
  return out;
}

export async function loadVaultPdf(admin: SupabaseClient, orgId: string, documentId: string): Promise<VaultPdf | null> {
  const { data } = await admin.from('documents').select('id, name, version, storage_path, kind, external_url, malware_scan_status, deal_memo_payload').eq('id', documentId).eq('org_id', orgId).maybeSingle();
  const d = data as Row | null;
  if (!d || !d.storage_path || d.external_url || d.deal_memo_payload || d.malware_scan_status === 'flagged') return null;
  const v = await latestVersion(admin, d);
  if (!isPdfName(d.name) && !isPdfName(v.storagePath)) return null;
  return { id: d.id as string, name: d.name as string, version: v.version, sizeBytes: v.size, storagePath: v.storagePath, versionId: v.versionId, sha256: v.sha256 };
}

export async function addFile(admin: SupabaseClient, f: {
  applicationId: string; callId: string; orgId: string; fieldId: string; source: 'upload' | 'vault'; fileName: string; size: number; sha256: string | null;
  storagePath: string; documentId?: string | null; versionId?: string | null; versionNumber?: number | null; userId: string; entryId?: string | null;
}): Promise<FileRow | null> {
  // One file per question (per entry, inside a group): a new one replaces the old (the old one's row goes; an uploaded object is removed by the caller).
  const { data, error } = await admin.from('call_application_files').insert({
    application_id: f.applicationId, call_id: f.callId, org_id: f.orgId, field_id: f.fieldId, source: f.source, file_name: f.fileName.slice(0, 200), size_bytes: f.size,
    sha256: f.sha256, storage_path: f.storagePath, document_id: f.documentId ?? null, version_id: f.versionId ?? null, version_number: f.versionNumber ?? null, created_by: f.userId, entry_id: f.entryId ?? null,
  }).select('*').single();
  return error || !data ? null : toFile(data as Row);
}

/** The size of a stored object, from the storage listing (the database may not know it for a Vault file's first version). */
export async function objectSize(admin: SupabaseClient, path: string): Promise<number | null> {
  try {
    const i = path.lastIndexOf('/');
    const { data } = await admin.storage.from('data-room').list(i >= 0 ? path.slice(0, i) : '', { search: path.slice(i + 1), limit: 5 });
    const hit = ((data ?? []) as { name: string; metadata?: { size?: number } }[]).find((o) => o.name === path.slice(i + 1));
    return typeof hit?.metadata?.size === 'number' ? hit.metadata.size : null;
  } catch { return null; }
}

/** Re-pin a Vault file to the document's latest version (the applicant confirmed). */
export async function repinVaultFile(admin: SupabaseClient, fileId: string, v: VaultPdf, size: number): Promise<boolean> {
  const { data } = await admin.from('call_application_files').update({
    file_name: v.name.slice(0, 200), size_bytes: size, sha256: v.sha256, storage_path: v.storagePath, version_id: v.versionId, version_number: v.version,
  }).eq('id', fileId).eq('source', 'vault').select('id');
  return (data ?? []).length > 0;
}

export async function removeFileRow(admin: SupabaseClient, applicationId: string, fileId: string): Promise<FileRow | null> {
  const { data } = await admin.from('call_application_files').select('*').eq('id', fileId).eq('application_id', applicationId).maybeSingle();
  if (!data) return null;
  await admin.from('call_application_files').delete().eq('id', fileId).eq('application_id', applicationId);
  return toFile(data as Row);
}

/** Files of vault source with a newer version in the Vault than the pinned one: {fileId -> latest}. */
export async function newerVaultVersions(admin: SupabaseClient, files: FileRow[]): Promise<Record<string, { versionNumber: number; fileName: string }>> {
  const out: Record<string, { versionNumber: number; fileName: string }> = {};
  for (const f of files.filter((x) => x.source === 'vault' && x.documentId)) {
    const { data } = await admin.from('documents').select('id, name, version, storage_path').eq('id', f.documentId as string).maybeSingle();
    if (!data) continue;
    const v = await latestVersion(admin, data as Row);
    if (f.versionNumber != null && v.version > f.versionNumber) out[f.id] = { versionNumber: v.version, fileName: (data as Row).name as string };
  }
  return out;
}

// ---- submission ---------------------------------------------------------------------------------------------------------------------

export interface SubmissionRow { id: string; version: number; answers: Answers; documents: FrozenDocument[]; submittedAt: string }
export interface FrozenDocument {
  fieldId: string; fileId: string; source: 'upload' | 'vault'; fileName: string; size: number; sha256: string | null; frozenPath: string;
  documentId: string | null; versionId: string | null; versionNumber: number | null;
}

const toSubmission = (r: Row): SubmissionRow => ({
  id: r.id as string, version: Number(r.version), answers: (r.answers as Answers) ?? {}, documents: ((r.documents as FrozenDocument[] | null) ?? []), submittedAt: r.submitted_at as string,
});

export async function findSubmissionByKey(admin: SupabaseClient, applicationId: string, key: string): Promise<SubmissionRow | null> {
  const { data } = await admin.from('call_application_submissions').select('*').eq('application_id', applicationId).eq('idempotency_key', key).maybeSingle();
  return data ? toSubmission(data as Row) : null;
}

export async function loadSubmission(admin: SupabaseClient, submissionId: string): Promise<SubmissionRow | null> {
  const { data } = await admin.from('call_application_submissions').select('*').eq('id', submissionId).maybeSingle();
  return data ? toSubmission(data as Row) : null;
}

/**
 * Can the document still be read? A HEAD on the stored object: nothing is copied, read or linked (the final check asks this for every document,
 * together with everything else). It must not mint a Storage URL to find out: that is a bearer link, and Prompt 750's guard
 * (verify:no-signed-url-leak) refuses one in src/lib. A missing object answers false; any other failure (Storage down) throws: both are a "no" here.
 */
export async function fileReadable(admin: SupabaseClient, f: FileRow): Promise<boolean> {
  try {
    const { data, error } = await admin.storage.from('data-room').exists(f.storagePath);
    return !error && data === true;
  } catch { return false; }
}

/**
 * Copy the bytes of a file into the submission's own place and note where. The path depends only on the file, so a retry (a second request,
 * a failed attempt) lands on the same object: "already exists" is a success. After this the submitted material does not depend on the Vault
 * or on the applicant's folder any more: whatever happens to either later, it stays as it was submitted.
 */
export async function freezeFile(admin: SupabaseClient, f: FileRow, to: string): Promise<boolean> {
  const { error } = await admin.storage.from('data-room').copy(f.storagePath, to);
  if (error && !/already exists|duplicate/i.test(error.message ?? '')) return false;
  await admin.from('call_application_files').update({ frozen_path: to, frozen_at: new Date().toISOString() }).eq('id', f.id);
  return true;
}

// ---- the state the form is rendered from -----------------------------------------------------------------------------------

export interface ApplicationState {
  application: { id: string; reference: string | null; status: ApplicationRow['status']; lastPage: number | null; revision: number; submittedAt: string | null };
  answers: Answers;
  fields: FormField[];
  files: (FileRef & { newer?: { versionNumber: number; fileName: string } })[];
  orgId: string;
  /** May it be edited right now? A draft, on a call that accepts applications (the server's clock). */
  canEdit: boolean;
  call: { name: string; currency: string; timezone: string; opensAt: string | null; closesAt: string | null; promoter: string; contactEmail?: string | null };
}

export async function buildApplicationState(
  admin: SupabaseClient, call: Call, fields: FormField[], app: ApplicationRow, promoter: string,
): Promise<ApplicationState> {
  const files = await loadFiles(admin, app.id);
  // A SUBMITTED application is shown from its immutable version (the answers and the frozen files), never from the working copy.
  if (app.status === 'submitted' && app.currentSubmissionId) {
    const sub = await loadSubmission(admin, app.currentSubmissionId);
    if (sub) {
      const frozen: FileRef[] = sub.documents.map((d) => ({ id: d.fileId, fieldId: d.fieldId, source: d.source, fileName: d.fileName, size: d.size, versionNumber: d.versionNumber, documentId: d.documentId }));
      return {
        application: { id: app.id, reference: app.reference, status: app.status, lastPage: app.lastPage, revision: app.revision, submittedAt: sub.submittedAt },
        answers: sub.answers, fields, files: frozen, orgId: app.orgId ?? '', canEdit: false,
        call: { name: call.name, currency: call.currency, timezone: call.timezone, opensAt: call.opensAt, closesAt: call.closesAt, promoter },
      };
    }
  }
  const newer = await newerVaultVersions(admin, files);
  const { data: accepting } = await admin.rpc('call_accepting', { p_call: call.id });
  return {
    application: { id: app.id, reference: app.reference, status: app.status, lastPage: app.lastPage, revision: app.revision, submittedAt: app.submittedAt },
    answers: sanitizeAnswers(fields, app.answers, files),
    fields,
    files: files.map((f) => ({ id: f.id, fieldId: f.fieldId, entryId: f.entryId ?? null, source: f.source, fileName: f.fileName, size: f.size, versionNumber: f.versionNumber, documentId: f.documentId, ...(newer[f.id] ? { newer: newer[f.id] } : {}) })),
    orgId: app.orgId ?? '',
    canEdit: app.status === 'draft' && accepting === true,
    call: { name: call.name, currency: call.currency, timezone: call.timezone, opensAt: call.opensAt, closesAt: call.closesAt, promoter },
  };
}

/** The page (1-based, among the pages that are shown) an application reopens on: where the applicant left it, never beyond the last. */
export function resumePage(fields: FormField[], answers: Answers, lastPage: number | null): number {
  const pages = visiblePages(fields, answers).length;
  return Math.min(Math.max(1, lastPage ?? 1), Math.max(1, pages));
}
